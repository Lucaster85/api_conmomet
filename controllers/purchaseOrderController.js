const { sendServerError } = require("../helpers/httpErrors");
const { Op } = require("sequelize");
const db = require("../models");
const { recordAudit } = require("../services/auditLogService");
const docs = require("../services/billingDocsService");
const billing = require("../services/billingService");

/**
 * OC del cliente (PLAN_ARCA.md §3.1, FLOWS.md §69). Todo cuelga de /invoices, así que middlewares/auth.js lo resuelve con invoices_read / write /
 * update / delete (sin permisos nuevos). Las rutas con nombre van ANTES de /invoices/:id.
 *
 * Opcional y flexible: un presupuesto puede no tener OC, tener una o varias vigentes. Rechazar y reemplazar deja la original guardada con su motivo y la nueva
 * la referencia (`replaces_id`). La regla "no rechazar ni reemplazar una OC con facturas vigentes sin pasarlas a la nueva" (B9) llega con la etapa 7, que es
 * cuando las facturas empiezan a referenciar OC.
 */

const CONCEPTS = ["materials", "labor", "all"];
const ADJUSTMENT_TYPES = ["ipc_indec", "uocra", "other"];
const CURRENCIES = ["ARS", "USD"];
const MAX_ITEMS = 100;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const sendError = (res, error) => (error.status ? res.status(error.status).json({ error: error.message }) : sendServerError(res, error));
const emptyToNull = (v) => (v === undefined || v === null || v === "" ? null : v);
const toBool = (v) => (v === true || v === "true" || v === "1" || v === 1 ? true : v === false || v === "false" || v === "0" || v === 0 ? false : null);
const isValidDate = (value) => {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};
const text = (v, max) => {
  const value = emptyToNull(v);
  return value === null ? null : String(value).trim().slice(0, max) || null;
};

// El alta y el reemplazo pueden llegar como multipart (con archivos): `items` viaja como JSON en un string.
function parseBody(req) {
  const body = { ...req.body };
  if (typeof body.items === "string") {
    try {
      body.items = JSON.parse(body.items);
    } catch {
      throw fail("Las posiciones de la OC no tienen un formato válido.");
    }
  }
  return body;
}

async function findApprovedBudget(budgetId, transaction) {
  const id = Number(budgetId);
  if (!Number.isInteger(id) || id < 1) throw fail("El presupuesto no es válido.");
  const budget = await db.Budget.findByPk(id, { transaction });
  if (!budget) throw fail("Presupuesto no encontrado.", 404);
  if (budget.status !== "approved") throw fail("Solo se cargan OC en presupuestos aprobados.");
  return budget;
}

/** Valida los datos de una OC y devuelve los valores y las posiciones listos para guardar. */
function parseOrder(body, budget) {
  const number = String(body.number === undefined || body.number === null ? "" : body.number).trim();
  if (!number) throw fail("El número de OC es obligatorio.");
  if (number.length > 60) throw fail("El número de OC admite hasta 60 caracteres.");
  if (!isValidDate(body.date)) throw fail("La fecha de la OC es obligatoria.");

  const concept = emptyToNull(body.concept) || "all";
  if (!CONCEPTS.includes(concept)) throw fail("El concepto de la OC no es válido.");
  const currency = emptyToNull(body.currency) || budget.currency;
  if (!CURRENCIES.includes(currency)) throw fail("La moneda de la OC no es válida.");

  // Sin monto, la OC es solo de referencia (sirve para poner su número en las facturas).
  let amount = emptyToNull(body.amount);
  if (amount !== null) {
    amount = Number(amount);
    if (!Number.isFinite(amount) || !(amount > 0)) throw fail("El monto de la OC tiene que ser mayor a cero (o dejalo vacío si es solo de referencia).");
    amount = Math.round(amount * 100) / 100;
  }

  const allowsAdjustment = toBool(body.allows_adjustment) === true;
  const adjustmentType = emptyToNull(body.adjustment_type) || "ipc_indec";
  if (!ADJUSTMENT_TYPES.includes(adjustmentType)) throw fail("El tipo de ajuste no es válido.");

  const rawItems = body.items === undefined || body.items === null ? [] : body.items;
  if (!Array.isArray(rawItems)) throw fail("Las posiciones de la OC no tienen un formato válido.");
  if (rawItems.length > MAX_ITEMS) throw fail(`Una OC admite hasta ${MAX_ITEMS} posiciones.`);
  const items = rawItems.map((raw, index) => {
    const description = text(raw.description, 255);
    if (!description) throw fail(`La posición ${index + 1} necesita una descripción.`);
    let itemAmount = emptyToNull(raw.amount);
    if (itemAmount !== null) {
      itemAmount = Number(itemAmount);
      if (!Number.isFinite(itemAmount) || itemAmount < 0) throw fail(`El monto de la posición ${index + 1} no es válido.`);
      itemAmount = Math.round(itemAmount * 100) / 100;
    }
    return { position: text(raw.position, 20), description, amount: itemAmount };
  });

  return {
    values: {
      number,
      date: body.date,
      concept,
      currency,
      amount,
      payment_terms: text(body.payment_terms, 5000),
      allows_adjustment: allowsAdjustment,
      adjustment_type: adjustmentType,
      // Las notas del ajuste solo tienen sentido si la OC lo admite.
      adjustment_notes: allowsAdjustment ? text(body.adjustment_notes, 5000) : null,
    },
    items,
  };
}

// Dos OC vigentes del mismo presupuesto no pueden tener el mismo número (una rechazada o reemplazada sí: la nueva puede conservar el número).
async function assertUniqueActiveNumber(budgetId, number, { excludeId = null, transaction } = {}) {
  const clash = await db.ClientPurchaseOrder.findOne({
    where: { budget_id: budgetId, number, status: "active", ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}) },
    transaction,
  });
  if (clash) throw fail(`Ya hay una OC vigente con el número ${number} en este presupuesto.`, 409);
}

// Líneas de facturas no anuladas que están facturadas contra la OC (las notas de crédito arrastran la OC de lo que acreditan).
const liveLinesOf = (orderId, transaction) =>
  db.InvoiceLine.findAll({
    where: { purchase_order_id: orderId },
    include: [{ model: db.Invoice, as: "invoice", attributes: ["id", "status"], required: true, where: { status: { [Op.ne]: "cancelled" } } }],
    transaction,
  });

async function auditOrder(order, action, userId, transaction, context = {}) {
  await recordAudit({
    entityType: "ClientPurchaseOrder", entityId: order.id, action, amount: order.amount === null ? undefined : Number(order.amount),
    context: { number: order.number, budget_id: order.budget_id, currency: order.currency, status: order.status, ...context }, userId,
  }, transaction);
}

module.exports = {
  // POST /invoices/purchase-orders (multipart: campos + `files` opcionales)
  create: async (req, res) => {
    try {
      const body = parseBody(req);
      const budget = await findApprovedBudget(body.budget_id);
      const parsed = parseOrder(body, budget);
      await assertUniqueActiveNumber(budget.id, parsed.values.number);

      const order = await db.sequelize.transaction(async (transaction) => {
        const created = await db.ClientPurchaseOrder.create({ ...parsed.values, budget_id: budget.id, status: "active", created_by: req.user.id }, { transaction });
        if (parsed.items.length) await db.ClientPurchaseOrderItem.bulkCreate(parsed.items.map((i) => ({ ...i, purchase_order_id: created.id })), { transaction });
        await auditOrder(created, "create", req.user.id, transaction);
        return created;
      });

      const warnings = await docs.storeFiles(req.files, {
        folder: `purchase-orders/${order.id}`, uploadedBy: req.user.id,
        createRecord: (file) => db.ClientPurchaseOrderFile.create({ ...file, purchase_order_id: order.id }),
      });
      return res.status(201).json({ data: docs.serializePurchaseOrder(await docs.reloadPurchaseOrder(order.id)), warnings });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // PUT /invoices/purchase-orders/:id — corrige los datos de una OC vigente. Las posiciones se reemplazan todas juntas.
  update: async (req, res) => {
    try {
      const order = await db.ClientPurchaseOrder.findByPk(req.params.id, { include: [{ model: db.Budget, as: "budget" }] });
      if (!order) throw fail("OC no encontrada.", 404);
      if (order.status !== "active") throw fail("Solo se puede editar una OC vigente.", 409);

      const parsed = parseOrder(parseBody(req), order.budget);
      await assertUniqueActiveNumber(order.budget_id, parsed.values.number, { excludeId: order.id });

      // Con facturas contra la OC no se pueden cambiar la moneda ni el concepto, ni bajar el monto por debajo de lo ya facturado.
      const lines = await liveLinesOf(order.id);
      if (lines.length > 0) {
        if (parsed.values.currency !== order.currency) throw fail("La OC tiene facturas: no se puede cambiar su moneda.", 409);
        if (parsed.values.concept !== "all" && lines.some((l) => l.concept !== parsed.values.concept)) {
          throw fail("La OC tiene facturas de otro concepto: no se puede limitar a un solo concepto.", 409);
        }
        const balance = (await billing.purchaseOrderBalances([{ id: order.id, currency: order.currency, amount: null }])).get(order.id);
        if (parsed.values.amount !== null && parsed.values.amount < balance.billed) {
          throw fail(`El monto de la OC no puede ser menor a lo ya facturado (${order.currency} ${balance.billed.toLocaleString("es-AR", { minimumFractionDigits: 2 })}).`, 409);
        }
      }

      await db.sequelize.transaction(async (transaction) => {
        await order.update(parsed.values, { transaction });
        await db.ClientPurchaseOrderItem.destroy({ where: { purchase_order_id: order.id }, transaction });
        if (parsed.items.length) await db.ClientPurchaseOrderItem.bulkCreate(parsed.items.map((i) => ({ ...i, purchase_order_id: order.id })), { transaction });
        await auditOrder(order, "update", req.user.id, transaction);
      });
      return res.status(200).json({ data: docs.serializePurchaseOrder(await docs.reloadPurchaseOrder(order.id)) });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // PUT /invoices/purchase-orders/:id/reject — { reason }. Rechaza la OC sin reemplazo: queda guardada, con su motivo.
  reject: async (req, res) => {
    try {
      const reason = text(req.body && req.body.reason, 2000);
      if (!reason) throw fail("El motivo del rechazo es obligatorio.");
      const order = await db.ClientPurchaseOrder.findByPk(req.params.id);
      if (!order) throw fail("OC no encontrada.", 404);
      if (order.status !== "active") throw fail("Solo se puede rechazar una OC vigente.", 409);
      // B9 (PLAN_ARCA.md §8): una OC con facturas vigentes no se rechaza a secas; hay que reemplazarla (las facturas pasan a la OC nueva) o anularlas.
      if ((await liveLinesOf(order.id)).length > 0) {
        throw fail("La OC tiene facturas vigentes: reemplazala por la OC nueva (las facturas pasan a ella) o anulá las facturas primero.", 409);
      }

      await db.sequelize.transaction(async (transaction) => {
        await order.update({ status: "rejected", rejection_reason: reason }, { transaction });
        await auditOrder(order, "update", req.user.id, transaction, { reason });
      });
      return res.status(200).json({ data: docs.serializePurchaseOrder(await docs.reloadPurchaseOrder(order.id)) });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // POST /invoices/purchase-orders/:id/replace — { reason, ...datos de la OC nueva }. La original queda "reemplazada", con su motivo, y la nueva la referencia.
  replace: async (req, res) => {
    try {
      const body = parseBody(req);
      const reason = text(body.reason, 2000);
      if (!reason) throw fail("El motivo del reemplazo es obligatorio.");
      const old = await db.ClientPurchaseOrder.findByPk(req.params.id, { include: [{ model: db.Budget, as: "budget" }] });
      if (!old) throw fail("OC no encontrada.", 404);
      if (old.status !== "active") throw fail("Solo se puede reemplazar una OC vigente.", 409);

      const parsed = parseOrder(body, old.budget);
      await assertUniqueActiveNumber(old.budget_id, parsed.values.number, { excludeId: old.id });

      // B9: las facturas vigentes de la OC original pasan a la nueva. Tiene que poder recibirlas: misma moneda, concepto compatible y monto suficiente.
      const lines = await liveLinesOf(old.id);
      if (lines.length > 0) {
        if (parsed.values.currency !== old.currency) throw fail("La OC original tiene facturas: la OC nueva tiene que ser en la misma moneda.", 409);
        if (parsed.values.concept !== "all" && lines.some((l) => l.concept !== parsed.values.concept)) {
          throw fail("La OC original tiene facturas de otro concepto: la OC nueva tiene que cubrir ese concepto.", 409);
        }
        const balance = (await billing.purchaseOrderBalances([{ id: old.id, currency: old.currency, amount: null }])).get(old.id);
        if (parsed.values.amount !== null && parsed.values.amount < balance.billed) {
          throw fail(`La OC nueva no cubre lo ya facturado (${old.currency} ${balance.billed.toLocaleString("es-AR", { minimumFractionDigits: 2 })}).`, 409);
        }
      }

      const created = await db.sequelize.transaction(async (transaction) => {
        await old.update({ status: "replaced", rejection_reason: reason }, { transaction });
        const order = await db.ClientPurchaseOrder.create(
          { ...parsed.values, budget_id: old.budget_id, status: "active", replaces_id: old.id, created_by: req.user.id },
          { transaction }
        );
        if (lines.length > 0) {
          await db.InvoiceLine.update({ purchase_order_id: order.id }, { where: { id: lines.map((l) => l.id) }, transaction });
        }
        if (parsed.items.length) await db.ClientPurchaseOrderItem.bulkCreate(parsed.items.map((i) => ({ ...i, purchase_order_id: order.id })), { transaction });
        await auditOrder(old, "update", req.user.id, transaction, { reason, replaced_by: order.id, invoice_lines_moved: lines.length });
        await auditOrder(order, "create", req.user.id, transaction, { replaces: old.id });
        return order;
      });

      const warnings = await docs.storeFiles(req.files, {
        folder: `purchase-orders/${created.id}`, uploadedBy: req.user.id,
        createRecord: (file) => db.ClientPurchaseOrderFile.create({ ...file, purchase_order_id: created.id }),
      });
      return res.status(201).json({ data: docs.serializePurchaseOrder(await docs.reloadPurchaseOrder(created.id)), warnings });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // DELETE /invoices/purchase-orders/:id (invoices_delete) — una OC cargada por error. No se elimina si tiene cauciones asociadas.
  destroy: async (req, res) => {
    try {
      const order = await db.ClientPurchaseOrder.findByPk(req.params.id, { include: [{ model: db.ClientPurchaseOrderFile, as: "files" }] });
      if (!order) throw fail("OC no encontrada.", 404);
      if (await db.InvoiceLine.count({ where: { purchase_order_id: order.id } })) {
        throw fail("La OC tiene facturas: no se puede eliminar. Si es una OC que ya no vale, rechazala o reemplazala.", 409);
      }
      if (await db.SuretyBond.count({ where: { purchase_order_id: order.id } })) {
        throw fail("La OC tiene seguros de caución asociados: eliminá o reasigná las cauciones primero.", 409);
      }
      await db.sequelize.transaction(async (transaction) => {
        await db.ClientPurchaseOrderFile.destroy({ where: { purchase_order_id: order.id }, transaction });
        await db.ClientPurchaseOrderItem.destroy({ where: { purchase_order_id: order.id }, transaction });
        await auditOrder(order, "delete", req.user.id, transaction);
        await order.destroy({ transaction });
      });
      for (const file of order.files) await docs.removeStoredFile(file.file_url);
      return res.status(200).json({ data: { id: order.id } });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // POST /invoices/purchase-orders/:id/files (multipart `files`)
  addFiles: async (req, res) => {
    try {
      const order = await db.ClientPurchaseOrder.findByPk(req.params.id);
      if (!order) throw fail("OC no encontrada.", 404);
      if (!req.files || req.files.length === 0) throw fail("Elegí al menos un archivo.");
      const warnings = await docs.storeFiles(req.files, {
        folder: `purchase-orders/${order.id}`, uploadedBy: req.user.id,
        createRecord: (file) => db.ClientPurchaseOrderFile.create({ ...file, purchase_order_id: order.id }),
      });
      return res.status(200).json({ data: docs.serializePurchaseOrder(await docs.reloadPurchaseOrder(order.id)), warnings });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // DELETE /invoices/purchase-orders/:id/files/:fileId (invoices_delete)
  removeFile: async (req, res) => {
    try {
      const file = await db.ClientPurchaseOrderFile.findOne({ where: { id: req.params.fileId, purchase_order_id: req.params.id } });
      if (!file) throw fail("Archivo no encontrado.", 404);
      await file.destroy();
      await docs.removeStoredFile(file.file_url);
      return res.status(200).json({ data: docs.serializePurchaseOrder(await docs.reloadPurchaseOrder(req.params.id)) });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // PUT /invoices/budgets/:budgetId/purchase-order-not-required — { value: true|false }. "Este presupuesto no lleva OC": apaga el aviso. Reversible.
  setNotRequired: async (req, res) => {
    try {
      const value = toBool(req.body && req.body.value);
      if (value === null) throw fail("Indicá si el presupuesto lleva OC o no.");
      const budget = await findApprovedBudget(req.params.budgetId);
      const previous = budget.purchase_order_not_required;
      await budget.update({ purchase_order_not_required: value });
      await recordAudit({
        entityType: "Budget", entityId: budget.id, action: "update", fieldChanged: "purchase_order_not_required",
        previousValue: previous, newValue: value, userId: req.user.id,
      });
      return res.status(200).json({ data: { budget_id: budget.id, purchase_order_not_required: value } });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // GET /invoices/purchase-orders/missing — presupuestos aprobados sin OC vigente y sin la marca "no lleva OC". Alimenta el aviso del tablero.
  missing: async (req, res) => {
    try {
      const budgets = await db.Budget.findAll({
        where: {
          status: "approved",
          purchase_order_not_required: false,
          [Op.and]: [db.sequelize.literal(
            "NOT EXISTS (SELECT 1 FROM ClientPurchaseOrders po WHERE po.budget_id = Budget.id AND po.status = 'active' AND po.deleted_at IS NULL)"
          )],
        },
        attributes: ["id", "number", "client_budget_number", "title", "currency", "approved_at"],
        include: [{ model: db.Client, as: "client", attributes: ["id", "razonSocial"] }],
        order: [["approved_at", "ASC"], ["id", "ASC"]],
      });
      return res.status(200).json({ data: budgets.map((b) => b.toJSON()) });
    } catch (error) {
      return sendError(res, error);
    }
  },
};
