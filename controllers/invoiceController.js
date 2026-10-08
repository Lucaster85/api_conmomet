const { Op } = require("sequelize");
const db = require("../models");
const { uploadToR2, deleteFromR2, userHasPermission } = require("../helpers");
const { recordAudit } = require("../services/auditLogService");
const { getInvoiceIvaRates } = require("../helpers/systemSettings");
const billing = require("../services/billingService");

/**
 * Facturación (ver FLOWS.md, sección Facturación).
 *
 * Todo cuelga de /invoices, así que el path de middlewares/auth.js lo resuelve con invoices_read /
 * write / update. Dos permisos más se chequean acá, a mano (mismo patrón que budgets_send):
 * - invoices_unofficial: cargar, ver y operar los cobros "sin factura".
 * - invoices_correct: corregir los datos de una factura ya cargada.
 * Las facturas no se borran (no hay DELETE): se anulan.
 */

const VOUCHER_TYPES = ["A", "B", "C", "E", "sin_factura"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const canSeeUnofficial = (user) => userHasPermission(user, "invoices_unofficial");
const todayStr = () => new Date().toISOString().slice(0, 10);

const isValidDate = (value) => {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};

const emptyToNull = (v) => (v === undefined || v === null || v === "" ? null : v);
const toIntOrNull = (v) => {
  const value = emptyToNull(v);
  if (value === null) return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
};

// El alta y la corrección llegan como multipart (el PDF + los campos): `lines` viaja como JSON en
// un string. Con un body JSON común ya viene como array.
function parseBody(req) {
  const body = { ...req.body };
  if (typeof body.lines === "string") {
    try {
      body.lines = JSON.parse(body.lines);
    } catch {
      throw fail("Las líneas de la factura no tienen un formato válido.");
    }
  }
  return body;
}

const invoiceInclude = [
  { model: db.Client, as: "client", attributes: ["id", "razonSocial", "cuit", "tax_condition"] },
  { model: db.Budget, as: "budget", attributes: ["id", "number", "title", "status"] },
  { model: db.Project, as: "project", attributes: ["id", "code", "name", "is_additional"] },
  { model: db.User, as: "createdBy", attributes: ["id", "name", "lastname"] },
  { model: db.InvoiceLine, as: "lines" },
];

// Los DECIMAL de Sequelize llegan como string. Acá se convierten una sola vez para que el
// frontend no tenga que acordarse de hacerlo (sumar strings concatena).
const toNum = (v) => (v === null || v === undefined ? null : Number(v));

function serializeInvoice(invoice) {
  const data = typeof invoice.toJSON === "function" ? invoice.toJSON() : invoice;
  return {
    ...data,
    exchange_rate: toNum(data.exchange_rate),
    net_amount: toNum(data.net_amount),
    iva_rate: toNum(data.iva_rate),
    iva_amount: toNum(data.iva_amount),
    total_amount: toNum(data.total_amount),
    lines: (data.lines || []).map((l) => ({
      ...l,
      percent: toNum(l.percent),
      net_amount: toNum(l.net_amount),
      base_gross_amount: toNum(l.base_gross_amount),
      base_discount_percent: toNum(l.base_discount_percent),
      base_net_amount: toNum(l.base_net_amount),
    })),
  };
}

// Para la auditoría: lo que se puede corregir de una factura, antes y después.
function auditSnapshot(invoice) {
  const data = serializeInvoice(invoice);
  const {
    voucher_type, pos_number, number, issue_date, due_date, client_id, budget_id, project_id, currency,
    exchange_rate, iva_rate, net_amount, iva_amount, total_amount, paid_at, notes, file_name,
  } = data;
  return {
    voucher_type, pos_number, number, issue_date, due_date, client_id, budget_id, project_id, currency,
    exchange_rate, iva_rate, net_amount, iva_amount, total_amount, paid_at, notes, file_name,
    lines: (data.lines || []).map((l) => ({ concept: l.concept, description: l.description, percent: l.percent, net_amount: l.net_amount })),
  };
}

const publicFileKey = (url) => (url ? url.replace(`${process.env.STORAGE_PUBLIC_URL}/`, "") : null);

/**
 * Valida el cuerpo de un alta o una corrección y devuelve los valores listos para guardar. Es el
 * mismo camino para las dos: la corrección es "volver a cargar bien" la factura. Los importes se
 * calculan siempre acá, contra el presupuesto real — nunca se toman del cliente.
 */
async function resolvePayload(body, { user, existing = null, transaction }) {
  const voucherType = body.voucher_type;
  if (!VOUCHER_TYPES.includes(voucherType)) throw fail("El tipo de comprobante no es válido.");
  const isUnofficial = voucherType === "sin_factura";
  if ((isUnofficial || existing?.voucher_type === "sin_factura") && !canSeeUnofficial(user)) {
    throw fail("No tenés permiso para cargar ni modificar cobros sin factura.", 403);
  }

  if (!isValidDate(body.issue_date)) throw fail("La fecha de emisión es obligatoria.");
  const dueDate = emptyToNull(body.due_date);
  if (dueDate !== null && !isValidDate(dueDate)) throw fail("El vencimiento de pago no es una fecha válida.");

  if (!["ARS", "USD"].includes(body.currency)) throw fail("La moneda de la factura no es válida.");

  const exchangeRate = emptyToNull(body.exchange_rate);
  if (exchangeRate !== null && !(Number(exchangeRate) > 0)) throw fail("La cotización tiene que ser un número mayor a cero.");

  // Presupuesto (se bloquea la fila mientras se valida el saldo: dos facturas simultáneas no
  // pueden pasarse del saldo juntas) o factura libre.
  const budgetId = toIntOrNull(body.budget_id);
  if (Number.isNaN(budgetId)) throw fail("El presupuesto no es válido.");

  let budget = null;
  let clientId;
  let projectId;
  if (budgetId !== null) {
    budget = await db.Budget.findByPk(budgetId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!budget) throw fail("Presupuesto no encontrado.", 404);
    if (budget.status !== "approved") throw fail("Solo se pueden facturar presupuestos aprobados.");
    clientId = budget.client_id;
    projectId = budget.project_id || null;
  } else {
    clientId = toIntOrNull(body.client_id);
    if (!clientId) throw fail("El cliente es obligatorio en una factura sin presupuesto.");
    const client = await db.Client.findByPk(clientId, { transaction });
    if (!client) throw fail("Cliente no encontrado.", 404);
    projectId = toIntOrNull(body.project_id);
    if (Number.isNaN(projectId)) throw fail("El proyecto no es válido.");
    if (projectId !== null) {
      const project = await db.Project.findByPk(projectId, { transaction });
      if (!project) throw fail("Proyecto no encontrado.", 404);
      if (project.client_id !== clientId) throw fail("El proyecto no pertenece al cliente elegido.");
    }
  }

  // IVA: "sin factura" no lleva. El resto, una de las alícuotas configuradas (o la que la factura
  // ya tenía, si se está corrigiendo y después se quitó de la lista).
  let ivaRate = 0;
  if (!isUnofficial) {
    const allowed = await getInvoiceIvaRates();
    const requested = emptyToNull(body.iva_rate);
    ivaRate = requested === null ? (allowed.includes(21) ? 21 : allowed[0]) : Number(requested);
    const keepsCurrent = existing && Number(existing.iva_rate) === ivaRate;
    if (!Number.isFinite(ivaRate) || (!allowed.includes(ivaRate) && !keepsCurrent)) {
      throw fail("La alícuota de IVA no está entre las configuradas.");
    }
  }

  // Número de comprobante: obligatorio y único por tipo y punto de venta (menos en "sin factura").
  let posNumber = null;
  let number = null;
  if (!isUnofficial) {
    posNumber = toIntOrNull(body.pos_number);
    number = toIntOrNull(body.number);
    if (!posNumber || Number.isNaN(posNumber) || posNumber < 1 || posNumber > 99999) {
      throw fail("El punto de venta es obligatorio (1 a 99999).");
    }
    if (!number || Number.isNaN(number) || number < 1 || number > 99999999) {
      throw fail("El número de comprobante es obligatorio (1 a 99999999).");
    }
    const duplicate = await db.Invoice.findOne({
      where: { voucher_type: voucherType, pos_number: posNumber, number, ...(existing ? { id: { [Op.ne]: existing.id } } : {}) },
      paranoid: false,
      transaction,
    });
    if (duplicate) {
      throw fail(`Ya existe un comprobante ${voucherType} ${String(posNumber).padStart(4, "0")}-${String(number).padStart(8, "0")}.`);
    }
  }

  const lines = await billing.validateInvoiceLines({
    budget,
    currency: body.currency,
    lines: body.lines,
    excludeInvoiceId: existing ? existing.id : null,
    transaction,
  });
  const totals = billing.computeInvoiceTotals(lines, ivaRate);

  return {
    lines,
    values: {
      voucher_type: voucherType,
      pos_number: posNumber,
      number,
      issue_date: body.issue_date,
      due_date: dueDate,
      client_id: clientId,
      budget_id: budget ? budget.id : null,
      project_id: projectId,
      currency: body.currency,
      exchange_rate: exchangeRate === null ? null : Number(exchangeRate),
      iva_rate: ivaRate,
      ...totals,
      notes: emptyToNull(body.notes) === null ? null : String(body.notes).trim(),
    },
  };
}

async function findInvoiceOr404(id, user, options = {}) {
  const invoice = await db.Invoice.findByPk(id, { include: [{ model: db.InvoiceLine, as: "lines" }], ...options });
  // Un cobro "sin factura" no existe para quien no tiene el permiso: ni siquiera se confirma que está.
  if (!invoice || (invoice.voucher_type === "sin_factura" && !canSeeUnofficial(user))) {
    throw fail("Factura no encontrada.", 404);
  }
  return invoice;
}

const reloadFull = (id) => db.Invoice.findByPk(id, { include: invoiceInclude });
const sendError = (res, error) => {
  // Red de seguridad: dos altas simultáneas con el mismo número pasan la validación del
  // controller pero las frena el índice único de la base.
  if (error.name === "SequelizeUniqueConstraintError") {
    return res.status(400).json({ error: "Ya existe un comprobante con ese tipo, punto de venta y número." });
  }
  return res.status(error.status || 500).json({ error: error.message });
};

// Cabecera del presupuesto que va con cada fila de "Por facturar".
function budgetHeader(budget) {
  const b = budget.toJSON();
  return {
    id: b.id,
    number: b.number,
    title: b.title,
    status: b.status,
    currency: b.currency,
    approved_at: b.approved_at,
    sent_at: b.sent_at,
    labor_discount_percent: toNum(b.labor_discount_percent),
    material_discount_percent: toNum(b.material_discount_percent),
    project_id: b.project_id,
    client: b.client,
    project: b.project,
    quoteRequest: b.quoteRequest,
  };
}

const billableInclude = [
  { model: db.Client, as: "client", attributes: ["id", "razonSocial", "cuit", "tax_condition"] },
  {
    model: db.Project, as: "project", attributes: ["id", "code", "name", "is_additional"],
    include: [{ model: db.Project, as: "parent", attributes: ["id", "code", "name"] }],
  },
  { model: db.QuoteRequest, as: "quoteRequest", attributes: ["id", "number", "client_quote_number", "title"] },
];

function ivaInfo(rates) {
  return { rates, default_rate: rates.includes(21) ? 21 : rates[0] };
}

module.exports = {
  // GET /invoices/billables — presupuestos aprobados con su resumen de facturación.
  billables: async (req, res) => {
    try {
      const { client_id, billing_status, has_pending_payment, q } = req.query;
      const where = { status: "approved" };
      if (client_id) where.client_id = client_id;

      let budgets = await db.Budget.findAll({ where, include: billableInclude, order: [["approved_at", "ASC"], ["id", "ASC"]] });

      if (q && String(q).trim()) {
        const needle = String(q).trim().toLowerCase();
        budgets = budgets.filter((b) => [
          b.number, b.title, b.client?.razonSocial, b.client?.cuit, b.project?.code, b.project?.name,
          b.quoteRequest?.number, b.quoteRequest?.client_quote_number,
        ].some((field) => field && String(field).toLowerCase().includes(needle)));
      }

      const summaries = await billing.computeBillingSummaries(budgets, { canSeeUnofficial: canSeeUnofficial(req.user) });

      let rows = budgets.map((b) => ({ ...budgetHeader(b), billing: summaries.get(b.id) }));
      if (billing_status) rows = rows.filter((r) => r.billing.billing_status === billing_status);
      if (has_pending_payment === "true") rows = rows.filter((r) => r.billing.has_pending_payment);

      // Orden: primero lo que todavía tiene algo para facturar, y dentro de eso lo que tiene
      // materiales con saldo (se pueden facturar antes de empezar); después el más avanzado en
      // horas, y por último el aprobado hace más tiempo.
      rows.sort((a, b) => {
        const byBalance = Number(b.billing.has_balance) - Number(a.billing.has_balance);
        if (byBalance) return byBalance;
        const byMaterials = Number(b.billing.has_materials_balance) - Number(a.billing.has_materials_balance);
        if (byMaterials) return byMaterials;
        const progress = (r) => r.billing.project_progress?.progress_percent ?? -1;
        if (progress(b) !== progress(a)) return progress(b) - progress(a);
        return new Date(a.approved_at || 0) - new Date(b.approved_at || 0);
      });

      return res.status(200).json({ data: rows, iva: ivaInfo(await getInvoiceIvaRates()) });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // GET /invoices/billables/:budgetId — detalle de facturación de un presupuesto.
  billable: async (req, res) => {
    try {
      const budget = await db.Budget.findByPk(req.params.budgetId, { include: billableInclude });
      if (!budget) return res.status(404).json({ error: "Presupuesto no encontrado." });
      if (budget.status !== "approved") return res.status(400).json({ error: "Solo se factura sobre presupuestos aprobados." });

      const unofficial = canSeeUnofficial(req.user);
      const plain = budget.toJSON();
      const dataById = await billing.loadBillingData([plain]);
      const data = dataById.get(budget.id);
      const summary = billing.buildBillingSummary(plain, { ...data, canSeeUnofficial: unofficial });

      // Todas las facturas, anuladas incluidas (en gris). Los cobros "sin factura" se ocultan a
      // quien no tiene el permiso, pero ya están descontados del saldo.
      const allInvoices = data.invoices;
      const visible = allInvoices
        .filter((inv) => unofficial || inv.voucher_type !== "sin_factura")
        .sort((a, b) => (a.issue_date < b.issue_date ? 1 : a.issue_date > b.issue_date ? -1 : b.id - a.id))
        .map(serializeInvoice);

      return res.status(200).json({
        data: {
          budget: budgetHeader(budget),
          billing: summary,
          hour_buckets: data.hours ? data.hours.hour_buckets : [],
          invoices: visible,
          has_reserved_records: !unofficial && allInvoices.some((inv) => inv.voucher_type === "sin_factura" && inv.status !== "cancelled"),
          iva: ivaInfo(await getInvoiceIvaRates()),
        },
      });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // GET /invoices — registro de comprobantes.
  getAll: async (req, res) => {
    try {
      const { status, client_id, voucher_type, date_from, date_to, budget_id, project_id } = req.query;
      const where = {};
      if (status) where.status = status;
      if (client_id) where.client_id = client_id;
      if (budget_id) where.budget_id = budget_id;
      if (project_id) where.project_id = project_id;
      if (date_from || date_to) {
        where.issue_date = {};
        if (date_from) where.issue_date[Op.gte] = date_from;
        if (date_to) where.issue_date[Op.lte] = date_to;
      }
      if (voucher_type) where.voucher_type = voucher_type;
      // Los cobros "sin factura" no existen para quien no tiene el permiso.
      if (!canSeeUnofficial(req.user)) {
        if (voucher_type === "sin_factura") return res.status(200).json({ data: [] });
        if (!voucher_type) where.voucher_type = { [Op.ne]: "sin_factura" };
      }

      const invoices = await db.Invoice.findAll({ where, include: invoiceInclude, order: [["issue_date", "DESC"], ["id", "DESC"]] });
      return res.status(200).json({ data: invoices.map(serializeInvoice) });
    } catch (error) {
      return sendError(res, error);
    }
  },

  get: async (req, res) => {
    try {
      const found = await findInvoiceOr404(req.params.id, req.user);
      return res.status(200).json({ data: serializeInvoice(await reloadFull(found.id)) });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // GET /invoices/client-options — clientes para el filtro y para la factura libre. Cuelga de
  // /invoices a propósito (como el catálogo de Adicionales): quien factura no necesariamente tiene
  // clients_read.
  clientOptions: async (req, res) => {
    try {
      const clients = await db.Client.findAll({
        attributes: ["id", "razonSocial", "cuit", "tax_condition", "is_active"],
        order: [["razonSocial", "ASC"]],
      });
      return res.status(200).json({ data: clients });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // GET /invoices/project-options?client_id= — proyectos del cliente, para la factura libre.
  projectOptions: async (req, res) => {
    try {
      const { client_id } = req.query;
      if (!client_id) return res.status(400).json({ error: "Indicá el cliente." });
      const projects = await db.Project.findAll({
        where: { client_id },
        attributes: ["id", "code", "name", "is_additional"],
        include: [{ model: db.Project, as: "parent", attributes: ["id", "code", "name"] }],
        order: [["created_at", "DESC"]],
      });
      return res.status(200).json({ data: projects });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // POST /invoices (multipart: `file` opcional + campos; `lines` como JSON).
  create: async (req, res) => {
    const transaction = await db.sequelize.transaction();
    let uploadedUrl = null;
    try {
      const payload = await resolvePayload(parseBody(req), { user: req.user, transaction });

      const invoice = await db.Invoice.create(
        { ...payload.values, status: "pending", created_by: req.user.id },
        { transaction },
      );
      await db.InvoiceLine.bulkCreate(payload.lines.map((l) => ({ ...l, invoice_id: invoice.id })), { transaction });

      if (req.file) {
        uploadedUrl = await uploadToR2(req.file, `invoices/${invoice.id}`);
        await invoice.update({ file_url: uploadedUrl, file_key: publicFileKey(uploadedUrl), file_name: req.file.originalname }, { transaction });
      }

      await recordAudit({
        entityType: "Invoice",
        entityId: invoice.id,
        action: "create",
        fieldChanged: "total_amount",
        newValue: payload.values.total_amount,
        amount: payload.values.total_amount,
        context: {
          voucher_type: payload.values.voucher_type,
          pos_number: payload.values.pos_number,
          number: payload.values.number,
          budget_id: payload.values.budget_id,
          currency: payload.values.currency,
          net_amount: payload.values.net_amount,
          iva_rate: payload.values.iva_rate,
        },
        userId: req.user.id,
      }, transaction);

      await transaction.commit();
      return res.status(201).json({ data: serializeInvoice(await reloadFull(invoice.id)) });
    } catch (error) {
      await transaction.rollback();
      if (uploadedUrl) deleteFromR2(uploadedUrl).catch(() => {});
      return sendError(res, error);
    }
  },

  // PUT /invoices/:id — corrige los datos de una factura mal cargada. Requiere invoices_correct
  // (además de invoices_update, que habilita la ruta). Pendiente o cobrada; una anulada no.
  update: async (req, res) => {
    if (!userHasPermission(req.user, "invoices_correct")) {
      return res.status(403).json({ error: "No tenés permiso para corregir facturas." });
    }
    const transaction = await db.sequelize.transaction();
    let uploadedUrl = null;
    try {
      const invoice = await findInvoiceOr404(req.params.id, req.user, { transaction });
      if (invoice.status === "cancelled") throw fail("Una factura anulada no se puede corregir.");

      const body = parseBody(req);
      const payload = await resolvePayload(body, { user: req.user, existing: invoice, transaction });
      const before = auditSnapshot(invoice);

      const updates = { ...payload.values };
      if (invoice.status === "paid" && emptyToNull(body.paid_at) !== null) {
        if (!isValidDate(body.paid_at)) throw fail("La fecha de cobro no es válida.");
        updates.paid_at = body.paid_at;
      }

      const previousFileUrl = invoice.file_url;
      if (req.file) {
        uploadedUrl = await uploadToR2(req.file, `invoices/${invoice.id}`);
        Object.assign(updates, { file_url: uploadedUrl, file_key: publicFileKey(uploadedUrl), file_name: req.file.originalname });
      }

      await invoice.update(updates, { transaction });
      await db.InvoiceLine.destroy({ where: { invoice_id: invoice.id }, transaction });
      await db.InvoiceLine.bulkCreate(payload.lines.map((l) => ({ ...l, invoice_id: invoice.id })), { transaction });

      const fresh = await db.Invoice.findByPk(invoice.id, { include: [{ model: db.InvoiceLine, as: "lines" }], transaction });
      await recordAudit({
        entityType: "Invoice",
        entityId: invoice.id,
        action: "update",
        fieldChanged: "invoice",
        amount: payload.values.total_amount,
        context: { before, after: auditSnapshot(fresh) },
        userId: req.user.id,
      }, transaction);

      await transaction.commit();
      if (uploadedUrl && previousFileUrl) deleteFromR2(previousFileUrl).catch(() => {});
      return res.status(200).json({ data: serializeInvoice(await reloadFull(invoice.id)) });
    } catch (error) {
      await transaction.rollback();
      if (uploadedUrl) deleteFromR2(uploadedUrl).catch(() => {});
      return sendError(res, error);
    }
  },

  // PUT /invoices/:id/pay (multipart) — { paid_at } y, opcional, `file` con el comprobante de pago.
  // Pendiente -> cobrada. No hay cobros parciales.
  pay: async (req, res) => {
    let uploadedUrl = null;
    try {
      const invoice = await findInvoiceOr404(req.params.id, req.user);
      if (invoice.status !== "pending") throw fail("Solo se puede marcar como cobrada una factura pendiente de cobro.");

      const paidAt = emptyToNull(req.body.paid_at) || todayStr();
      if (!isValidDate(paidAt)) throw fail("La fecha de cobro no es válida.");

      const updates = { status: "paid", paid_at: paidAt };
      if (req.file) {
        uploadedUrl = await uploadToR2(req.file, `invoices/${invoice.id}/payment`);
        Object.assign(updates, {
          payment_file_url: uploadedUrl,
          payment_file_key: publicFileKey(uploadedUrl),
          payment_file_name: req.file.originalname,
        });
      }

      await invoice.update(updates);
      await recordAudit({
        entityType: "Invoice",
        entityId: invoice.id,
        action: "update",
        fieldChanged: "status",
        previousValue: "pending",
        newValue: "paid",
        amount: invoice.total_amount,
        context: { paid_at: paidAt, payment_receipt: req.file ? req.file.originalname : null },
        userId: req.user.id,
      });
      return res.status(200).json({ data: serializeInvoice(await reloadFull(invoice.id)) });
    } catch (error) {
      if (uploadedUrl) deleteFromR2(uploadedUrl).catch(() => {});
      return sendError(res, error);
    }
  },

  // PUT /invoices/:id/cancel — { reason }. Pendiente o cobrada -> anulada; libera el saldo.
  // Es para cuando la factura real se anuló: un dato mal cargado se corrige (PUT /:id), no se anula.
  cancel: async (req, res) => {
    try {
      const reason = String(req.body.reason || "").trim();
      if (!reason) throw fail("El motivo de la anulación es obligatorio.");

      const invoice = await findInvoiceOr404(req.params.id, req.user);
      if (invoice.status === "cancelled") throw fail("La factura ya está anulada.");

      const previousStatus = invoice.status;
      await invoice.update({ status: "cancelled", cancelled_at: new Date(), cancellation_reason: reason });
      await recordAudit({
        entityType: "Invoice",
        entityId: invoice.id,
        action: "update",
        fieldChanged: "status",
        previousValue: previousStatus,
        newValue: "cancelled",
        amount: invoice.total_amount,
        context: { reason },
        userId: req.user.id,
      });
      return res.status(200).json({ data: serializeInvoice(await reloadFull(invoice.id)) });
    } catch (error) {
      return sendError(res, error);
    }
  },
};
