const { Op } = require("sequelize");
const db = require("../models");
const { recordAudit } = require("../services/auditLogService");
const docs = require("../services/billingDocsService");
const progress = require("../services/budgetProgressService");

/**
 * Avance real de obra (PLAN_ARCA.md §3.4, FLOWS.md §72). Cuelga de /invoices (invoices_read / write / update / delete, sin permisos nuevos), igual que las
 * OC y las cauciones. Es una medición paralela a la de horas: no la modifica.
 */

const SOURCES = ["certificate", "manual"];
const STATUSES = ["presented", "approved", "rejected"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const sendError = (res, error) => res.status(error.status || 500).json({ error: error.message });
const emptyToNull = (v) => (v === undefined || v === null || v === "" ? null : v);
const isValidDate = (value) => {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};
const text = (v, max) => {
  const value = emptyToNull(v);
  return value === null ? null : String(value).trim().slice(0, max) || null;
};

const entryInclude = [
  { model: db.BudgetProgressEntryFile, as: "files", include: [{ model: db.User, as: "uploader", attributes: ["id", "name", "lastname"] }] },
  { model: db.User, as: "createdBy", attributes: ["id", "name", "lastname"] },
];
const reload = (id) => db.BudgetProgressEntry.findByPk(id, { include: entryInclude });

async function findApprovedBudget(budgetId) {
  const id = Number(budgetId);
  if (!Number.isInteger(id) || id < 1) throw fail("El presupuesto no es válido.");
  const budget = await db.Budget.findByPk(id);
  if (!budget) throw fail("Presupuesto no encontrado.", 404);
  if (budget.status !== "approved") throw fail("Solo se carga el avance en presupuestos aprobados.");
  return budget;
}

/** Valida el cuerpo y devuelve los valores listos para guardar. `others`: las demás mediciones del presupuesto (para la regla de avance acumulado). */
function parseEntry(body, others) {
  if (!isValidDate(body.date)) throw fail("La fecha del avance es obligatoria.");
  const percent = Math.round(Number(body.percent) * 100) / 100;
  if (emptyToNull(body.percent) === null || !Number.isFinite(percent) || !(percent > 0) || percent > 100) throw fail("El avance tiene que estar entre 0 y 100%.");

  const source = emptyToNull(body.source) || "manual";
  if (!SOURCES.includes(source)) throw fail("El origen del avance no es válido.");
  let certificateNumber = null;
  let status = null;
  if (source === "certificate") {
    certificateNumber = text(body.certificate_number, 60);
    if (!certificateNumber) throw fail("El número de certificado es obligatorio.");
    status = emptyToNull(body.status) || "presented";
    if (!STATUSES.includes(status)) throw fail("El estado del certificado no es válido.");
  }

  const values = { date: body.date, percent, source, certificate_number: certificateNumber, status, notes: text(body.notes, 5000) };
  if (progress.isCounted(values)) {
    const message = progress.monotonicError(others, values);
    if (message) throw fail(message, 409);
  }
  return values;
}

const audit = (entry, action, userId, context = {}) =>
  recordAudit({
    entityType: "BudgetProgressEntry", entityId: entry.id, action,
    context: { budget_id: entry.budget_id, percent: Number(entry.percent), source: entry.source, status: entry.status, ...context }, userId,
  });

module.exports = {
  // POST /invoices/progress-entries (multipart: campos + `files` opcionales)
  create: async (req, res) => {
    try {
      const budget = await findApprovedBudget(req.body.budget_id);
      const others = await db.BudgetProgressEntry.findAll({ where: { budget_id: budget.id } });
      const values = parseEntry(req.body, others);
      const entry = await db.BudgetProgressEntry.create({ ...values, budget_id: budget.id, created_by: req.user.id });
      await audit(entry, "create", req.user.id);
      const warnings = await docs.storeFiles(req.files, {
        folder: `progress-entries/${entry.id}`, uploadedBy: req.user.id,
        createRecord: (file) => db.BudgetProgressEntryFile.create({ ...file, progress_entry_id: entry.id }),
      });
      return res.status(201).json({ data: progress.serializeEntry(await reload(entry.id)), warnings });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // PUT /invoices/progress-entries/:id
  update: async (req, res) => {
    try {
      const entry = await db.BudgetProgressEntry.findByPk(req.params.id);
      if (!entry) throw fail("Avance no encontrado.", 404);
      const others = await db.BudgetProgressEntry.findAll({ where: { budget_id: entry.budget_id, id: { [Op.ne]: entry.id } } });
      await entry.update(parseEntry(req.body, others));
      await audit(entry, "update", req.user.id);
      return res.status(200).json({ data: progress.serializeEntry(await reload(entry.id)) });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // DELETE /invoices/progress-entries/:id (invoices_delete) — 409 si alguna factura lo referencia.
  destroy: async (req, res) => {
    try {
      const entry = await db.BudgetProgressEntry.findByPk(req.params.id, { include: [{ model: db.BudgetProgressEntryFile, as: "files" }] });
      if (!entry) throw fail("Avance no encontrado.", 404);
      if (await db.InvoiceLine.count({ where: { progress_entry_id: entry.id } })) {
        throw fail("Hay facturas que se asocian a este avance: no se puede eliminar.", 409);
      }
      await audit(entry, "delete", req.user.id);
      await db.BudgetProgressEntryFile.destroy({ where: { progress_entry_id: entry.id } });
      await entry.destroy();
      for (const file of entry.files) await docs.removeStoredFile(file.file_url);
      return res.status(200).json({ data: { id: entry.id } });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // POST /invoices/progress-entries/:id/files (multipart `files`)
  addFiles: async (req, res) => {
    try {
      const entry = await db.BudgetProgressEntry.findByPk(req.params.id);
      if (!entry) throw fail("Avance no encontrado.", 404);
      if (!req.files || req.files.length === 0) throw fail("Elegí al menos un archivo.");
      const warnings = await docs.storeFiles(req.files, {
        folder: `progress-entries/${entry.id}`, uploadedBy: req.user.id,
        createRecord: (file) => db.BudgetProgressEntryFile.create({ ...file, progress_entry_id: entry.id }),
      });
      return res.status(200).json({ data: progress.serializeEntry(await reload(entry.id)), warnings });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // DELETE /invoices/progress-entries/:id/files/:fileId (invoices_delete)
  removeFile: async (req, res) => {
    try {
      const file = await db.BudgetProgressEntryFile.findOne({ where: { id: req.params.fileId, progress_entry_id: req.params.id } });
      if (!file) throw fail("Archivo no encontrado.", 404);
      await file.destroy();
      await docs.removeStoredFile(file.file_url);
      return res.status(200).json({ data: progress.serializeEntry(await reload(req.params.id)) });
    } catch (error) {
      return sendError(res, error);
    }
  },
};
