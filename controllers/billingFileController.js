const { sendServerError } = require("../helpers/httpErrors");
const db = require("../models");
const { recordAudit } = require("../services/auditLogService");
const docs = require("../services/billingDocsService");

/** Documentos extra del presupuesto para facturar (FLOWS.md §69): contratos, planillas, lo que el cliente pida adjuntar. Cuelga de /invoices (invoices_*). */

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const sendError = (res, error) => (error.status ? res.status(error.status).json({ error: error.message }) : sendServerError(res, error));

const include = [{ model: db.User, as: "uploader", attributes: ["id", "name", "lastname"] }];

module.exports = {
  // POST /invoices/billing-files (multipart: budget_id, description opcional, `files`)
  create: async (req, res) => {
    try {
      const budgetId = Number(req.body.budget_id);
      const budget = Number.isInteger(budgetId) ? await db.Budget.findByPk(budgetId) : null;
      if (!budget) throw fail("Presupuesto no encontrado.", 404);
      if (budget.status !== "approved") throw fail("Solo se adjuntan documentos en presupuestos aprobados.");
      if (!req.files || req.files.length === 0) throw fail("Elegí al menos un archivo.");
      const description = req.body.description ? String(req.body.description).trim().slice(0, 255) || null : null;

      const warnings = await docs.storeFiles(req.files, {
        folder: `billing-files/${budget.id}`, uploadedBy: req.user.id,
        createRecord: (file) => db.BudgetBillingFile.create({ ...file, budget_id: budget.id, description }),
      });
      const files = await db.BudgetBillingFile.findAll({ where: { budget_id: budget.id }, include, order: [["id", "DESC"]] });
      return res.status(201).json({ data: files.map(docs.serializeBillingFile), warnings });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // DELETE /invoices/billing-files/:id (invoices_delete)
  destroy: async (req, res) => {
    try {
      const file = await db.BudgetBillingFile.findByPk(req.params.id);
      if (!file) throw fail("Archivo no encontrado.", 404);
      await recordAudit({ entityType: "BudgetBillingFile", entityId: file.id, action: "delete", context: { budget_id: file.budget_id, file_name: file.file_name }, userId: req.user.id });
      await file.destroy();
      await docs.removeStoredFile(file.file_url);
      return res.status(200).json({ data: { id: file.id } });
    } catch (error) {
      return sendError(res, error);
    }
  },
};
