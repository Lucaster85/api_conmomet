/**
 * Suma estimated_total (mano de obra) y total_price (materiales) agrupados por moneda —
 * nunca se netea ARS contra USD. Usado tanto por budgetController (listado/detalle de
 * Presupuestos) como por projectController (pestaña "Presupuesto" del detalle de proyecto),
 * para no duplicar el cálculo en dos lugares.
 */
function computeTotalsByCurrency(budget, laborLines, materialItems) {
  const totals = { ARS: 0, USD: 0 };
  for (const line of laborLines) {
    const currency = line.currency || budget.currency;
    totals[currency] = (totals[currency] || 0) + parseFloat(line.estimated_total || 0);
  }
  for (const item of materialItems) {
    const currency = item.currency || budget.currency;
    totals[currency] = (totals[currency] || 0) + parseFloat(item.total_price || 0);
  }
  return totals;
}

module.exports = { computeTotalsByCurrency };
