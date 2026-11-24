"use strict";
// Cómo se nombra un presupuesto en el texto de una factura (FLOWS.md §79): por el N° con el que lo identifica el CLIENTE
// (el que citan sus OC), no por el nuestro (PRES-AAAA-NNN), que al cliente no le sirve para rastrear el trabajo.
// Lo comparten el PDF de la factura y las líneas de ajuste; el frontend lo repite igual (InvoiceDialog y
// InvoiceAdjustmentDialog, que dicen "el mismo texto que arma el servidor"): si se cambia acá, cambiarlo allá.
const NO_CLIENT_BUDGET_NUMBER = "Sin N° de pres. cliente";

/** "Pres. cliente 2026-0451", o "Sin N° de pres. cliente" si el presupuesto todavía no lo tiene. */
function clientBudgetReference(budget) {
  const number = budget && budget.client_budget_number ? String(budget.client_budget_number).trim() : "";
  return number ? `Pres. cliente ${number}` : NO_CLIENT_BUDGET_NUMBER;
}

module.exports = { clientBudgetReference, NO_CLIENT_BUDGET_NUMBER };
