const { Op } = require("sequelize");
const db = require("../models");
const { recordAudit } = require("../services/auditLogService");
const docs = require("../services/billingDocsService");
const { suretyBondStatus, daysUntilExpiration } = require("../services/suretyBondService");
const { todayInArgentina } = require("../helpers/argentinaDate");

/**
 * Seguros de caución (PLAN_ARCA.md §3.2, FLOWS.md §69). Cuelgan de /invoices (invoices_*). Una póliza tiene un solo archivo. Mientras no esté
 * liberada y tenga vencimiento, el notificador (services/expirationNotifier.js) avisa antes de vencer y al vencer; "liberada" corta los avisos.
 */

const PURPOSES = ["advance_payment", "other"];
const CURRENCIES = ["ARS", "USD"];
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

const bondInclude = [{ model: db.ClientPurchaseOrder, as: "purchaseOrder", attributes: ["id", "number"] }];
const reload = (id) => db.SuretyBond.findByPk(id, { include: bondInclude });

async function parseBond(body, budget) {
  const insurer = text(body.insurer, 150);
  if (!insurer) throw fail("La aseguradora es obligatoria.");
  const policyNumber = text(body.policy_number, 80);
  if (!policyNumber) throw fail("El número de póliza es obligatorio.");

  const amount = Math.round(Number(body.amount) * 100) / 100;
  if (emptyToNull(body.amount) === null || !Number.isFinite(amount) || !(amount > 0)) throw fail("El monto de la caución tiene que ser mayor a cero.");
  const currency = emptyToNull(body.currency) || budget.currency;
  if (!CURRENCIES.includes(currency)) throw fail("La moneda de la caución no es válida.");
  const purpose = emptyToNull(body.purpose) || "advance_payment";
  if (!PURPOSES.includes(purpose)) throw fail("El motivo de la caución no es válido.");

  const issueDate = emptyToNull(body.issue_date);
  if (issueDate !== null && !isValidDate(issueDate)) throw fail("La fecha de emisión no es válida.");
  const expirationDate = emptyToNull(body.expiration_date);
  if (expirationDate !== null && !isValidDate(expirationDate)) throw fail("La fecha de vencimiento no es válida.");
  if (issueDate && expirationDate && expirationDate < issueDate) throw fail("El vencimiento no puede ser anterior a la emisión.");

  let notifyDays = emptyToNull(body.notify_days_before);
  notifyDays = notifyDays === null ? 30 : Number(notifyDays);
  if (!Number.isInteger(notifyDays) || notifyDays < 0 || notifyDays > 365) throw fail("Los días de aviso tienen que estar entre 0 y 365.");

  // La OC asociada, si hay, tiene que ser del mismo presupuesto.
  let purchaseOrderId = emptyToNull(body.purchase_order_id);
  if (purchaseOrderId !== null) {
    purchaseOrderId = Number(purchaseOrderId);
    const order = Number.isInteger(purchaseOrderId) ? await db.ClientPurchaseOrder.findByPk(purchaseOrderId) : null;
    if (!order || order.budget_id !== budget.id) throw fail("La OC elegida no pertenece a este presupuesto.");
  }

  return {
    insurer, policy_number: policyNumber, amount, currency, purpose, issue_date: issueDate, expiration_date: expirationDate,
    notify_days_before: notifyDays, purchase_order_id: purchaseOrderId, notes: text(body.notes, 5000),
  };
}

async function findApprovedBudget(budgetId) {
  const id = Number(budgetId);
  if (!Number.isInteger(id) || id < 1) throw fail("El presupuesto no es válido.");
  const budget = await db.Budget.findByPk(id);
  if (!budget) throw fail("Presupuesto no encontrado.", 404);
  if (budget.status !== "approved") throw fail("Solo se cargan cauciones en presupuestos aprobados.");
  return budget;
}

async function attachFile(bond, file, userId) {
  const warnings = await docs.storeFiles([file], {
    folder: `surety-bonds/${bond.id}`, uploadedBy: userId,
    createRecord: async (data) => {
      const { uploaded_by: _ignored, ...fileData } = data;
      if (bond.file_url) await docs.removeStoredFile(bond.file_url);
      await bond.update(fileData);
    },
  });
  return warnings;
}

const audit = (bond, action, userId, context = {}) =>
  recordAudit({
    entityType: "SuretyBond", entityId: bond.id, action, amount: Number(bond.amount),
    context: { policy_number: bond.policy_number, insurer: bond.insurer, budget_id: bond.budget_id, currency: bond.currency, ...context }, userId,
  });

module.exports = {
  // POST /invoices/surety-bonds (multipart: campos + un `files` opcional)
  create: async (req, res) => {
    try {
      const budget = await findApprovedBudget(req.body.budget_id);
      const values = await parseBond(req.body, budget);
      const bond = await db.SuretyBond.create({ ...values, budget_id: budget.id, created_by: req.user.id });
      await audit(bond, "create", req.user.id);
      const warnings = req.files && req.files[0] ? await attachFile(bond, req.files[0], req.user.id) : [];
      return res.status(201).json({ data: docs.serializeSuretyBond(await reload(bond.id)), warnings });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // PUT /invoices/surety-bonds/:id — corrige los datos; si llega un archivo, reemplaza el anterior.
  update: async (req, res) => {
    try {
      const bond = await db.SuretyBond.findByPk(req.params.id, { include: [{ model: db.Budget, as: "budget" }] });
      if (!bond) throw fail("Caución no encontrada.", 404);
      const values = await parseBond(req.body, bond.budget);
      await bond.update(values);
      await audit(bond, "update", req.user.id);
      const warnings = req.files && req.files[0] ? await attachFile(bond, req.files[0], req.user.id) : [];
      return res.status(200).json({ data: docs.serializeSuretyBond(await reload(bond.id)), warnings });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // PUT /invoices/surety-bonds/:id/release — { released: true|false }. Liberada = el cliente la devolvió o venció su razón de ser: corta los avisos.
  release: async (req, res) => {
    try {
      const raw = req.body && req.body.released;
      const released = raw === true || raw === "true";
      if (!released && !(raw === false || raw === "false")) throw fail("Indicá si la caución está liberada o no.");
      const bond = await db.SuretyBond.findByPk(req.params.id);
      if (!bond) throw fail("Caución no encontrada.", 404);
      await bond.update({ released_at: released ? todayInArgentina() : null });
      await audit(bond, "update", req.user.id, { released });
      return res.status(200).json({ data: docs.serializeSuretyBond(await reload(bond.id)) });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // DELETE /invoices/surety-bonds/:id (invoices_delete)
  destroy: async (req, res) => {
    try {
      const bond = await db.SuretyBond.findByPk(req.params.id);
      if (!bond) throw fail("Caución no encontrada.", 404);
      await audit(bond, "delete", req.user.id);
      await bond.destroy();
      await docs.removeStoredFile(bond.file_url);
      return res.status(200).json({ data: { id: bond.id } });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // GET /invoices/surety-bonds/alerts — cauciones por vencer o vencidas (sin liberar). Alimenta el aviso del tablero.
  alerts: async (req, res) => {
    try {
      const today = todayInArgentina();
      const bonds = await db.SuretyBond.findAll({
        where: { released_at: null, expiration_date: { [Op.ne]: null } },
        include: [{ model: db.Budget, as: "budget", attributes: ["id", "number", "title"], include: [{ model: db.Client, as: "client", attributes: ["id", "razonSocial"] }] }],
        order: [["expiration_date", "ASC"], ["id", "ASC"]],
      });
      const data = bonds
        .map((b) => ({ ...b.toJSON(), amount: Number(b.amount), status: suretyBondStatus(b, today), days_left: daysUntilExpiration(b, today) }))
        .filter((b) => b.status === "expired" || b.status === "expiring_soon");
      return res.status(200).json({ data });
    } catch (error) {
      return sendError(res, error);
    }
  },
};
