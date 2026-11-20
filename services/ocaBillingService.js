// Facturar OCAs (PLAN_ARCA.md etapa 10, FLOWS.md §74). Una OCA es un remito de horas (hombre o de grúa) que el cliente aprueba y, según el cliente, también
// aprueba su presupuesto. Cuando está lista se factura ENTERA en una línea de factura (`InvoiceLines.oca_id`, concepto `oca`): no hay facturación parcial ni
// porcentajes, y no toca ningún saldo de presupuesto. Una OCA se factura una sola vez: mientras tenga una factura vigente (no anulada) no se factura de nuevo.
//
// El importe se calcula acá con la MISMA regla que el presupuesto de la pantalla de OCAs (conmomet-app/src/app/dashboard/ocas/page.tsx#budgetCost):
// - horas hombre: (horas simples + 1,5 x horas al 50% + 2 x horas al 100%) x valor hora de la OCA
// - grúa: horas totales de cada vehículo x el valor hora de ese vehículo
// El cliente NUNCA manda el importe: sale siempre de estos datos. Siempre en pesos (las OCAs no tienen moneda).
const { Op } = require("sequelize");
const db = require("../models");

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => Number(v) || 0;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

const TYPE_LABELS = { man_hours: "Hora hombre", crane_hours: "Servicio de grúa" };

/** Horas de una OCA por tipo (para mostrarlas y para el cálculo). Las de grúa se cuentan por vehículo. */
function summarizeHours(oca) {
  const lines = oca.lines || [];
  const regular = round2(lines.reduce((acc, l) => acc + num(l.regular_hours), 0));
  const ot50 = round2(lines.reduce((acc, l) => acc + num(l.overtime_50_hours), 0));
  const ot100 = round2(lines.reduce((acc, l) => acc + num(l.overtime_100_hours), 0));
  return { regular, ot50, ot100, total: round2(regular + ot50 + ot100) };
}

/**
 * Importe neto (sin IVA) de una OCA y si ya tiene precio cargado. Pura.
 * @param {object} oca OCA con `type`, `hourly_rate` y `lines` (OcaLine: horas, vehicle_id, hourly_rate)
 * @returns {{ net: number, priced: boolean }}
 */
function computeOcaNet(oca) {
  const lines = oca.lines || [];
  if (oca.type === "man_hours") {
    const rate = num(oca.hourly_rate);
    if (!(rate > 0)) return { net: 0, priced: false };
    const h = summarizeHours(oca);
    return { net: round2(h.regular * rate + h.ot50 * rate * 1.5 + h.ot100 * rate * 2), priced: true };
  }
  // Grúa: solo cuentan las líneas con vehículo, y cada una necesita el valor hora de su vehículo.
  const crane = lines.filter((l) => l.vehicle_id);
  if (crane.length === 0 || crane.some((l) => !(num(l.hourly_rate) > 0))) return { net: 0, priced: false };
  return { net: round2(crane.reduce((acc, l) => acc + (num(l.regular_hours) + num(l.overtime_50_hours) + num(l.overtime_100_hours)) * num(l.hourly_rate), 0)), priced: true };
}

/**
 * Motivos por los que una OCA todavía no se puede facturar (vacío = se puede). Pura.
 * Tiene que estar aprobada por el cliente; si pidió presupuesto, el presupuesto también aprobado; con precio cargado y un importe mayor a cero.
 */
function billingProblems(oca) {
  const problems = [];
  if (oca.status !== "aprobado") problems.push("La OCA todavía no está aprobada.");
  if (oca.requires_budget && oca.budget_status !== "aprobado") problems.push("El presupuesto de la OCA todavía no está aprobado.");
  const { net, priced } = computeOcaNet(oca);
  if (!priced) problems.push("La OCA no tiene el valor hora cargado.");
  else if (!(net > 0)) problems.push("La OCA no tiene horas para facturar.");
  return problems;
}

/** Factura vigente (no anulada) que cobra cada OCA: Map<ocaId, { invoice_id, ... }>. `excludeInvoiceId`: la propia factura, al editarla. */
async function liveInvoicesByOca(ocaIds, { excludeInvoiceId = null, transaction } = {}) {
  const result = new Map();
  if (ocaIds.length === 0) return result;
  const rows = await db.InvoiceLine.findAll({
    where: { oca_id: { [Op.in]: ocaIds } },
    include: [{
      model: db.Invoice, as: "invoice", required: true, attributes: ["id", "cbte_tipo", "pos_number", "number", "voucher_type", "status", "arca_status"],
      where: { status: { [Op.ne]: "cancelled" }, ...(excludeInvoiceId ? { id: { [Op.ne]: excludeInvoiceId } } : {}) },
    }],
    transaction,
  });
  for (const row of rows) result.set(row.oca_id, row.invoice.toJSON());
  return result;
}

const ocaInclude = [
  { model: db.OcaLine, as: "lines" },
  { model: db.Client, as: "client", attributes: ["id", "razonSocial"] },
  { model: db.Project, as: "project", attributes: ["id", "code", "name"] },
];

/** OCAs aprobadas de un cliente con su importe, lo que les falta y la factura que las cobra (para elegirlas al armar una factura). */
async function listBillableOcas(clientId) {
  const ocas = await db.Oca.findAll({ where: { client_id: clientId, status: "aprobado" }, include: ocaInclude, order: [["date", "ASC"], ["id", "ASC"]] });
  const invoices = await liveInvoicesByOca(ocas.map((o) => o.id));
  return ocas.map((oca) => {
    const plain = oca.toJSON();
    const { net } = computeOcaNet(plain);
    const invoice = invoices.get(oca.id) || null;
    const problems = billingProblems(plain);
    return {
      id: oca.id, number: oca.number, type: oca.type, date: oca.date, client_id: oca.client_id, project: plain.project || null,
      requires_budget: oca.requires_budget, budget_status: oca.budget_status, hourly_rate: oca.hourly_rate === null ? null : Number(oca.hourly_rate),
      hours: summarizeHours(plain), net_amount: net, problems, invoice, billable: problems.length === 0 && !invoice,
    };
  });
}

/**
 * Valida y arma las líneas de factura de las OCA elegidas. Bloquea las OCA (FOR UPDATE, por id) para que dos facturas simultáneas no cobren la misma.
 * @param {Array<{oca_id:number, description?:string}>} lines
 * @returns {Promise<{ lines: object[], ocas: Map<number, object> }>} líneas listas para InvoiceLine.bulkCreate y las OCA (modelos)
 */
async function resolveOcaLines({ lines, currency, excludeInvoiceId = null, transaction }) {
  if (currency !== "ARS") throw fail("Las OCA se facturan en pesos.");
  const ids = lines.map((l) => Number(l.oca_id));
  if (ids.some((id) => !Number.isInteger(id) || id < 1)) throw fail("Una de las OCA no es válida.");
  if (new Set(ids).size !== ids.length) throw fail("Una OCA está repetida en la factura.");

  const sorted = [...ids].sort((a, b) => a - b);
  // Las filas se bloquean solas (sin joins) y las horas se piden aparte.
  const rows = await db.Oca.findAll({ where: { id: { [Op.in]: sorted } }, order: [["id", "ASC"]], transaction, lock: transaction.LOCK.UPDATE });
  const ocaLines = await db.OcaLine.findAll({ where: { oca_id: { [Op.in]: sorted } }, transaction });
  const byId = new Map(rows.map((o) => [o.id, { ...o.toJSON(), lines: ocaLines.filter((l) => l.oca_id === o.id).map((l) => l.toJSON()) }]));
  const billed = await liveInvoicesByOca(sorted, { excludeInvoiceId, transaction });

  const out = lines.map((line) => {
    const oca = byId.get(Number(line.oca_id));
    if (!oca) throw fail("OCA no encontrada.", 404);
    const problems = billingProblems(oca);
    if (problems.length > 0) throw fail(`La OCA ${oca.number} no se puede facturar: ${problems.join(" ")}`);
    if (billed.has(oca.id)) throw fail(`La OCA ${oca.number} ya está facturada: anulá esa factura para poder facturarla de nuevo.`, 409);
    const { net } = computeOcaNet(oca);
    const description = line.description && String(line.description).trim() ? String(line.description).trim() : `${TYPE_LABELS[oca.type]} OCA ${oca.number}`;
    return { concept: "oca", oca_id: oca.id, description: description.slice(0, 255), percent: 100, net_amount: net, budget_id: null, purchase_order_id: null, progress_entry_id: null };
  });
  return { lines: out, ocas: byId };
}

module.exports = { computeOcaNet, billingProblems, summarizeHours, liveInvoicesByOca, listBillableOcas, resolveOcaLines, TYPE_LABELS };
