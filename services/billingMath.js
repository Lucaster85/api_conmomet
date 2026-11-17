// Parte pura (sin base de datos) del cálculo de saldos de Facturación: constantes, redondeos y lo ya facturado. Vive aparte de billingService.js para
// poder testearse sin DB. billingService.js la importa y la re-exporta.

const CONCEPTS = ["materials", "labor"];
const CURRENCIES = ["ARS", "USD"];
// Tolerancia de un centavo: los montos se redondean a 2 decimales y el porcentaje a 4.
const TOLERANCE = 0.01;

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const round4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;
const num = (v) => Number(v) || 0;

/**
 * Suma lo facturado por moneda y concepto de una lista de facturas (con `lines`). Reglas (PLAN_ARCA.md §8, B9):
 * - Una factura anulada no suma (por eso anular libera el saldo).
 * - Una NOTA DE CRÉDITO RESTA, pero solo si ya fue emitida en ARCA (un borrador no libera saldo: se podría facturar de nuevo sobre él y
 *   después descartar la nota) y solo si su factura original sigue en la lista. Cuando una NC total deja la original anulada, la original ya
 *   no suma y su NC tampoco resta: si no, se descontaría dos veces.
 * - Una NOTA DE DÉBITO no toca el saldo del presupuesto: es un cargo adicional (intereses, diferencia de cambio), no avance facturado.
 */
function sumBilled(invoices) {
  const billed = {};
  for (const currency of CURRENCIES) billed[currency] = { materials: 0, labor: 0 };
  const liveIds = new Set(invoices.filter((inv) => inv.status !== "cancelled").map((inv) => inv.id));
  for (const invoice of invoices) {
    if (invoice.status === "cancelled") continue;
    const kind = invoice.kind || "invoice";
    if (kind === "debit_note") continue;
    let sign = 1;
    if (kind === "credit_note") {
      if (invoice.arca_status !== "authorized") continue;
      if (!liveIds.has(invoice.associated_invoice_id)) continue;
      sign = -1;
    }
    for (const line of invoice.lines || []) {
      if (!billed[invoice.currency] || billed[invoice.currency][line.concept] === undefined) continue;
      billed[invoice.currency][line.concept] += sign * num(line.net_amount);
    }
  }
  for (const currency of CURRENCIES) {
    for (const concept of CONCEPTS) billed[currency][concept] = round2(billed[currency][concept]);
  }
  return billed;
}

module.exports = { CONCEPTS, CURRENCIES, TOLERANCE, round2, round4, num, sumBilled };
