// Notas de crédito y de débito de facturas emitidas por ARCA (PLAN_ARCA.md etapa 5, FLOWS.md §68).
//
// - Una NOTA DE CRÉDITO acredita líneas de la factura original (`credits_line_id`), por porcentaje o por monto, sin pasarse de lo que queda por
//   acreditar de cada línea. Los borradores cuentan para ese límite (dos borradores no pueden acreditar dos veces lo mismo), pero solo una nota
//   YA EMITIDA libera saldo del presupuesto (ver billingService#sumBilled). Cuando las notas emitidas cubren TODAS las líneas, la factura original
//   queda anulada (`reconcileOriginalCredits`).
// - Una NOTA DE DÉBITO es un cargo adicional con líneas libres (descripción y monto): no toca el saldo del presupuesto.
// - Las dos nacen como borrador y se emiten por ARCA con el mismo circuito de las facturas (services/arca/emission.js).
const { Op } = require("sequelize");
const db = require("../models");
const billing = require("./billingService");
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
const toIntOrNull = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
};
const toBool = (v) => (v === true || v === "true" || v === "1" || v === 1 ? true : v === false || v === "false" || v === "0" || v === 0 ? false : null);
const CONCEPT_LABELS = { materials: "materiales", labor: "mano de obra", other: "otros conceptos" };
const MAX_DEBIT_LINES = 50;

/**
 * Cuánto de cada línea ya está acreditado por notas de crédito NO anuladas, borradores incluidos. `excludeInvoiceId`: la propia nota,
 * cuando se está editando. Devuelve Map<lineId, neto acreditado>.
 */
async function creditedByLine(originalLineIds, { excludeInvoiceId = null, transaction } = {}) {
  const credited = new Map();
  if (originalLineIds.length === 0) return credited;
  const rows = await db.InvoiceLine.findAll({
    where: { credits_line_id: { [Op.in]: originalLineIds } },
    include: [{
      model: db.Invoice, as: "invoice", attributes: ["id"], required: true,
      where: { kind: "credit_note", status: { [Op.ne]: "cancelled" }, ...(excludeInvoiceId ? { id: { [Op.ne]: excludeInvoiceId } } : {}) },
    }],
    transaction,
  });
  for (const row of rows) credited.set(row.credits_line_id, round2((credited.get(row.credits_line_id) || 0) + num(row.net_amount)));
  return credited;
}

/**
 * Valida y arma el borrador de una nota (alta o edición). Hereda de la factura original todo lo que ARCA exige que coincida: cliente,
 * presupuesto, moneda, cotización, alícuota de IVA, concepto, período y datos del receptor. El usuario elige la fecha, el punto de venta,
 * qué acreditar (o qué cargo agregar) y el motivo.
 *
 * Bloquea la fila de la factura original mientras valida: dos notas simultáneas no pueden acreditar entre las dos más que la factura.
 *
 * @returns {Promise<{ lines: object[], values: object }>} listo para Invoice.create / update + InvoiceLine.bulkCreate
 */
async function resolveNoteDraft({ body, kind, existing = null, transaction }) {
  const originalId = existing ? existing.associated_invoice_id : toIntOrNull(body.associated_invoice_id);
  if (!originalId || Number.isNaN(originalId)) throw fail("Indicá la factura sobre la que se hace la nota.");

  const original = await db.Invoice.findByPk(originalId, {
    include: [{ model: db.InvoiceLine, as: "lines" }], transaction, lock: transaction.LOCK.UPDATE,
  });
  if (!original) throw fail("Factura no encontrada.", 404);
  if (original.source !== "arca" || original.arca_status !== "authorized" || (original.kind || "invoice") !== "invoice") {
    throw fail("Las notas de crédito y de débito se hacen sobre una factura ya emitida en ARCA.", 409);
  }
  if (original.status === "cancelled") throw fail("La factura está anulada: ya no admite notas.", 409);
  const cbteTipo = fe.noteCbteFor(original.cbte_tipo, kind);
  if (!cbteTipo) throw fail("Este tipo de factura no admite notas desde la app.", 409);

  if (!isValidDate(body.issue_date)) throw fail("La fecha de la nota es obligatoria.");

  // Punto de venta: por defecto el de la factura original. Tiene que ser de web service y estar activo.
  const posId = toIntOrNull(body.point_of_sale_id) || original.point_of_sale_id;
  const pointOfSale = posId ? await db.CompanyPointOfSale.findByPk(posId, { transaction }) : null;
  if (!pointOfSale || !pointOfSale.is_active || pointOfSale.type !== "web_service") {
    throw fail("El punto de venta no es válido para emitir por ARCA (tiene que ser de tipo web service y estar activo).");
  }

  const reason = body.notes === undefined || body.notes === null ? "" : String(body.notes).trim();
  if (kind === "credit_note" && !reason) throw fail("Indicá el motivo de la nota de crédito.");

  // Marca de anulación de una nota de FCE: ARCA solo la admite si el comprador rechazó la FCE (10154). Se valida acá, con lo registrado a mano.
  const fceNote = fe.isFceNote(cbteTipo);
  const annulment = fceNote ? toBool(body.fce_annulment) === true : null;
  if (annulment && original.fce_acceptance !== "rejected") {
    throw fail("La anulación de una FCE solo corresponde si el cliente la rechazó en ARCA: registralo en la aceptación de la factura o emití la nota sin marca de anulación.");
  }

  const ivaRate = num(original.iva_rate);
  if (IVA_ID[ivaRate] === undefined) throw fail(`ARCA no tiene la alícuota de IVA ${ivaRate}%.`);

  let lines;
  if (kind === "credit_note") {
    if (!Array.isArray(body.lines) || body.lines.length === 0) throw fail("Indicá qué se acredita.");
    const originalLines = new Map(original.lines.map((l) => [l.id, l]));
    const credited = await creditedByLine([...originalLines.keys()], { excludeInvoiceId: existing ? existing.id : null, transaction });
    const seen = new Set();
    lines = body.lines.map((raw) => {
      const lineId = toIntOrNull(raw.credits_line_id);
      const origLine = lineId ? originalLines.get(lineId) : null;
      if (!origLine) throw fail("Una de las líneas a acreditar no pertenece a la factura original.");
      if (seen.has(lineId)) throw fail("Una línea de la factura está repetida en la nota.");
      seen.add(lineId);
      const label = CONCEPT_LABELS[origLine.concept] || "la línea";
      const remaining = round2(num(origLine.net_amount) - (credited.get(lineId) || 0));
      if (remaining <= TOLERANCE) throw fail(`${label[0].toUpperCase()}${label.slice(1)} ya está acreditado por completo.`);

      // El usuario carga el monto O el porcentaje (sobre la línea de la factura original); el otro se recalcula.
      let net;
      if (num(raw.net_amount) > 0) net = round2(raw.net_amount);
      else if (num(raw.percent) > 0) net = round2((num(origLine.net_amount) * num(raw.percent)) / 100);
      else throw fail(`Indicá el porcentaje o el monto a acreditar de ${label}.`);
      if (!(net > 0)) throw fail(`El monto a acreditar de ${label} es demasiado chico.`);
      if (net > remaining + TOLERANCE) {
        throw fail(`El monto a acreditar de ${label} supera lo que queda por acreditar (${original.currency} ${remaining.toLocaleString("es-AR", { minimumFractionDigits: 2 })}).`);
      }
      return {
        concept: origLine.concept,
        description: raw.description ? String(raw.description).trim().slice(0, 255) || null : null,
        percent: round4((net / num(origLine.net_amount)) * 100),
        net_amount: net,
        credits_line_id: lineId,
      };
    });
  } else {
    if (!Array.isArray(body.lines) || body.lines.length === 0) throw fail("Agregá al menos un concepto a la nota de débito.");
    if (body.lines.length > MAX_DEBIT_LINES) throw fail(`Una nota de débito admite hasta ${MAX_DEBIT_LINES} líneas.`);
    lines = body.lines.map((raw, index) => {
      const description = String(raw.description || "").trim();
      if (!description) throw fail(`La línea ${index + 1} necesita una descripción.`);
      const net = round2(raw.net_amount);
      if (!(net > 0)) throw fail(`La línea ${index + 1} necesita un monto mayor a cero.`);
      return { concept: "other", description: description.slice(0, 255), percent: null, net_amount: net, credits_line_id: null };
    });
  }

  const totals = billing.computeInvoiceTotals(lines, ivaRate);
  const isUsd = original.currency === "USD";
  const rate = original.exchange_rate === null ? null : Number(original.exchange_rate);

  return {
    lines,
    values: {
      voucher_type: "A",
      cbte_tipo: cbteTipo,
      kind,
      associated_invoice_id: original.id,
      source: "arca",
      arca_status: "draft",
      arca_env: null,
      arca_result: null,
      point_of_sale_id: pointOfSale.id,
      pos_number: pointOfSale.number,
      number: null,
      issue_date: body.issue_date,
      due_date: original.due_date,
      client_id: original.client_id,
      budget_id: original.budget_id,
      project_id: original.project_id,
      currency: original.currency,
      exchange_rate: rate,
      same_currency_payment: original.same_currency_payment,
      iva_rate: ivaRate,
      ...totals,
      total_amount_ars: isUsd && rate ? round2(totals.total_amount * rate) : totals.total_amount,
      arca_concept: original.arca_concept,
      service_from: original.service_from,
      service_to: original.service_to,
      recipient_doc_type: original.recipient_doc_type,
      recipient_doc_number: original.recipient_doc_number,
      recipient_vat_condition_id: original.recipient_vat_condition_id,
      sale_condition: original.sale_condition,
      remito_number: original.remito_number,
      commercial_reference: original.commercial_reference,
      bank_account_id: null,
      fce_transfer_option: null,
      fce_annulment: annulment,
      notes: reason || null,
    },
  };
}

/**
 * Después de emitir una nota de crédito: si las notas EMITIDAS ya acreditan todas las líneas de la factura original, la factura queda
 * anulada (y libera su saldo). Idempotente. Devuelve true si anuló la original en esta llamada.
 */
async function reconcileOriginalCredits(originalId, { transaction } = {}) {
  const original = await db.Invoice.findByPk(originalId, { include: [{ model: db.InvoiceLine, as: "lines" }], transaction });
  if (!original || (original.kind || "invoice") !== "invoice" || original.status === "cancelled" || original.lines.length === 0) return false;

  const notes = await db.Invoice.findAll({
    where: { associated_invoice_id: original.id, kind: "credit_note", arca_status: "authorized", status: { [Op.ne]: "cancelled" } },
    include: [{ model: db.InvoiceLine, as: "lines" }],
    order: [["id", "ASC"]],
    transaction,
  });
  if (notes.length === 0) return false;

  const credited = new Map();
  for (const note of notes) {
    for (const line of note.lines) {
      if (line.credits_line_id) credited.set(line.credits_line_id, round2((credited.get(line.credits_line_id) || 0) + num(line.net_amount)));
    }
  }
  const fullyCredited = original.lines.every((l) => (credited.get(l.id) || 0) >= num(l.net_amount) - TOLERANCE);
  if (!fullyCredited) return false;

  const last = notes[notes.length - 1];
  await original.update(
    {
      status: "cancelled",
      cancelled_at: new Date(),
      cancellation_reason: `Anulada con la nota de crédito ${fe.voucherLabel(last.cbte_tipo, last.pos_number, last.number || 0)}.`,
    },
    { transaction }
  );
  return true;
}

module.exports = { resolveNoteDraft, reconcileOriginalCredits, creditedByLine };
