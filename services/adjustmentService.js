// Ajustes de precio de facturas emitidas por ARCA (PLAN_ARCA.md etapa 8, §3.3; FLOWS.md §71).
//
// El ajuste (IPC INDEC, UOCRA, otro índice) se factura como una FACTURA NUEVA, no como nota de débito: sale por el mismo circuito de emisión que
// cualquier factura (borrador -> emitir). Queda vinculada a la original (`adjusts_invoice_id`) y NO descuenta saldo del presupuesto ni de la OC
// (sus líneas son de concepto `adjustment`, que `billingMath.sumBilled` no suma).
//
// Reglas:
// - Sobre una factura emitida por ARCA, no anulada, que no sea ya un ajuste (un ajuste no se ajusta).
// - Un solo ajuste VIGENTE por factura. Se valida con la original bloqueada (FOR UPDATE) y, de segunda barrera, un índice único sobre una columna
//   generada. Si el ajuste se anula o se descarta, se puede crear otro.
// - Solo se ajustan líneas de materiales o mano de obra; si la línea es de una OC, la OC tiene que admitir ajuste (`allows_adjustment`). Sin OC se permite.
// - La base de cada línea es lo que queda de ella después de las notas de crédito (los borradores cuentan). El usuario carga el % o el monto.
// - Hereda de la original todo lo que ARCA exige que coincida (cliente, moneda, cotización, IVA, concepto, receptor, y en una FCE la cuenta y la
//   opción de transferencia); elige fecha, punto de venta, vencimiento y período.
const { Op } = require("sequelize");
const db = require("../models");
const billing = require("./billingService");
const noteService = require("./creditNoteService");
const fe = require("./arca/feRequest");
const { IVA_ID } = require("./arca/codes");

const { round2, TOLERANCE } = billing;
const round4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;
const num = (v) => Number(v) || 0;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isValidDate = (value) => {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};
const emptyToNull = (v) => (v === undefined || v === null || v === "" ? null : v);
const toIntOrNull = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
};

const TYPES = ["ipc_indec", "uocra", "other"];
const TYPE_LABELS = { ipc_indec: "IPC INDEC", uocra: "UOCRA", other: "índice" };
const ADJUSTABLE = ["materials", "labor"];
const MAX_PERCENT = 1000;
const MAX_LINES = 50;

/** La factura de ajuste VIGENTE de una factura, si la tiene. `excludeInvoiceId`: la propia, al editarla. */
const liveAdjustmentOf = (originalId, { excludeInvoiceId = null, transaction } = {}) =>
  db.Invoice.findOne({
    where: { adjusts_invoice_id: originalId, status: { [Op.ne]: "cancelled" }, ...(excludeInvoiceId ? { id: { [Op.ne]: excludeInvoiceId } } : {}) },
    transaction,
  });

/**
 * Valida y arma el borrador de una factura de ajuste (alta o edición).
 * @returns {Promise<{ lines: object[], values: object }>} listo para Invoice.create / update + InvoiceLine.bulkCreate
 */
async function resolveAdjustmentDraft({ body, existing = null, transaction }) {
  const originalId = existing ? existing.adjusts_invoice_id : toIntOrNull(body.adjusts_invoice_id);
  if (!originalId || Number.isNaN(originalId)) throw fail("Indicá la factura que se ajusta.");

  const original = await db.Invoice.findByPk(originalId, {
    include: [{ model: db.InvoiceLine, as: "lines" }], transaction, lock: transaction.LOCK.UPDATE,
  });
  if (!original) throw fail("Factura no encontrada.", 404);
  if (original.source !== "arca" || original.arca_status !== "authorized" || (original.kind || "invoice") !== "invoice") {
    throw fail("Los ajustes se hacen sobre una factura ya emitida en ARCA.", 409);
  }
  if (original.adjusts_invoice_id) throw fail("Una factura de ajuste no se puede volver a ajustar.", 409);
  if (original.status === "cancelled") throw fail("La factura está anulada: ya no admite ajustes.", 409);
  if (await liveAdjustmentOf(original.id, { excludeInvoiceId: existing ? existing.id : null, transaction })) {
    throw fail("La factura ya tiene un ajuste vigente: solo se puede crear otro si ese se anula.", 409);
  }

  if (!isValidDate(body.issue_date)) throw fail("La fecha de la factura de ajuste es obligatoria.");
  const dueDate = emptyToNull(body.due_date) === null ? original.due_date : body.due_date;
  if (dueDate !== null && !isValidDate(dueDate)) throw fail("El vencimiento de pago no es una fecha válida.");
  const serviceFrom = emptyToNull(body.service_from) === null ? original.service_from : body.service_from;
  const serviceTo = emptyToNull(body.service_to) === null ? original.service_to : body.service_to;
  for (const [label, value] of [["desde", serviceFrom], ["hasta", serviceTo]]) {
    if (value !== null && !isValidDate(value)) throw fail(`La fecha ${label} del período facturado no es válida.`);
  }

  const posId = toIntOrNull(body.point_of_sale_id) || original.point_of_sale_id;
  const pointOfSale = posId ? await db.CompanyPointOfSale.findByPk(posId, { transaction }) : null;
  if (!pointOfSale || !pointOfSale.is_active || pointOfSale.type !== "web_service") {
    throw fail("El punto de venta no es válido para emitir por ARCA (tiene que ser de tipo web service y estar activo).");
  }

  const ivaRate = num(original.iva_rate);
  if (IVA_ID[ivaRate] === undefined) throw fail(`ARCA no tiene la alícuota de IVA ${ivaRate}%.`);

  if (!Array.isArray(body.lines) || body.lines.length === 0) throw fail("Elegí al menos una línea para ajustar.");
  if (body.lines.length > MAX_LINES) throw fail(`Un ajuste admite hasta ${MAX_LINES} líneas.`);

  // Datos de lo que se ajusta: OC y presupuesto de cada línea, y cuánto de cada una ya se acreditó.
  const originalLines = new Map(original.lines.map((l) => [l.id, l]));
  const orderIds = [...new Set(original.lines.map((l) => l.purchase_order_id).filter(Boolean))];
  const budgetIds = [...new Set(original.lines.map((l) => l.budget_id).filter(Boolean))];
  const [orders, budgets, credited] = await Promise.all([
    orderIds.length ? db.ClientPurchaseOrder.findAll({ where: { id: { [Op.in]: orderIds } }, transaction }) : [],
    budgetIds.length ? db.Budget.findAll({ where: { id: { [Op.in]: budgetIds } }, attributes: ["id", "number"], transaction }) : [],
    noteService.creditedByLine([...originalLines.keys()], { transaction }),
  ]);
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const budgetById = new Map(budgets.map((b) => [b.id, b]));
  const period = emptyToNull(body.adjustment_period) === null ? null : String(body.adjustment_period).trim().slice(0, 60);
  const originalLabel = fe.voucherLabel(original.cbte_tipo, original.pos_number, original.number || 0);

  const seen = new Set();
  const lines = body.lines.map((raw) => {
    const lineId = toIntOrNull(raw.adjusts_line_id);
    const origLine = lineId ? originalLines.get(lineId) : null;
    if (!origLine) throw fail("Una de las líneas a ajustar no pertenece a la factura original.");
    if (seen.has(lineId)) throw fail("Una línea de la factura está repetida en el ajuste.");
    seen.add(lineId);
    if (!ADJUSTABLE.includes(origLine.concept)) throw fail("Solo se ajustan las líneas de materiales o mano de obra.");

    const order = origLine.purchase_order_id ? orderById.get(origLine.purchase_order_id) : null;
    if (order && !order.allows_adjustment) throw fail(`La OC ${order.number} no admite ajuste de precios.`);

    const type = emptyToNull(raw.adjustment_type) || (order && order.adjustment_type) || "ipc_indec";
    if (!TYPES.includes(type)) throw fail("El tipo de ajuste no es válido.");

    const base = round2(num(origLine.net_amount) - (credited.get(lineId) || 0));
    if (base <= TOLERANCE) throw fail("Esa línea ya está acreditada por completo: no hay nada para ajustar.");

    // El usuario carga el monto O el porcentaje (sobre la base de la línea); el otro se recalcula.
    let net;
    if (num(raw.net_amount) > 0) net = round2(raw.net_amount);
    else if (num(raw.percent) > 0) net = round2((base * num(raw.percent)) / 100);
    else throw fail("Indicá el porcentaje o el monto del ajuste de cada línea.");
    if (!(net > 0)) throw fail("El monto del ajuste es demasiado chico.");
    const percent = round4((net / base) * 100);
    if (percent > MAX_PERCENT) throw fail(`El ajuste no puede superar el ${MAX_PERCENT}% de la línea.`);

    const budget = origLine.budget_id ? budgetById.get(origLine.budget_id) : null;
    const typed = TYPE_LABELS[type];
    const defaultDescription = [
      `Ajuste ${typed}${period ? ` (${period})` : ""} s/ ${originalLabel}`,
      order ? `OC ${order.number}` : null,
      budget ? budget.number : null,
    ].filter(Boolean).join(" – ");
    const description = raw.description && String(raw.description).trim() ? String(raw.description).trim() : defaultDescription;

    return {
      concept: "adjustment",
      description: description.slice(0, 255),
      percent,
      net_amount: net,
      budget_id: origLine.budget_id || null,
      purchase_order_id: origLine.purchase_order_id || null,
      adjusts_line_id: lineId,
      adjustment_type: type,
      adjustment_percent: percent,
      adjustment_base_amount: base,
    };
  });

  const totals = billing.computeInvoiceTotals(lines, ivaRate);
  const isUsd = original.currency === "USD";
  const rate = original.exchange_rate === null ? null : Number(original.exchange_rate);
  const lineBudgets = new Set(lines.map((l) => l.budget_id).filter(Boolean));
  const reason = body.notes === undefined || body.notes === null ? "" : String(body.notes).trim();

  return {
    lines,
    values: {
      voucher_type: "A",
      cbte_tipo: original.cbte_tipo,
      adjusts_invoice_id: original.id,
      source: "arca",
      arca_status: "draft",
      arca_env: null,
      arca_result: null,
      point_of_sale_id: pointOfSale.id,
      pos_number: pointOfSale.number,
      number: null,
      issue_date: body.issue_date,
      due_date: dueDate,
      client_id: original.client_id,
      manual_recipient: original.manual_recipient,
      budget_id: lineBudgets.size === 1 && !lines.some((l) => !l.budget_id) ? [...lineBudgets][0] : null,
      project_id: original.project_id,
      currency: original.currency,
      exchange_rate: rate,
      same_currency_payment: original.same_currency_payment,
      iva_rate: ivaRate,
      ...totals,
      total_amount_ars: isUsd && rate ? round2(totals.total_amount * rate) : totals.total_amount,
      arca_concept: original.arca_concept,
      service_from: original.arca_concept === 1 ? null : serviceFrom,
      service_to: original.arca_concept === 1 ? null : serviceTo,
      recipient_doc_type: original.recipient_doc_type,
      recipient_doc_number: original.recipient_doc_number,
      recipient_vat_condition_id: original.recipient_vat_condition_id,
      sale_condition: original.sale_condition,
      remito_number: original.remito_number,
      commercial_reference: original.commercial_reference,
      bank_account_id: original.bank_account_id,
      fce_transfer_option: original.fce_transfer_option,
      notes: reason || null,
    },
  };
}

module.exports = { resolveAdjustmentDraft, liveAdjustmentOf, TYPE_LABELS };
