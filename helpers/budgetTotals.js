/**
 * Suma estimated_total (mano de obra) y total_price (materiales) agrupados por moneda —
 * nunca se netea ARS contra USD. Usado tanto por budgetController (listado/detalle de
 * Presupuestos) como por projectController (pestaña "Presupuesto" del detalle de proyecto),
 * para no duplicar el cálculo en dos lugares.
 *
 * Aplica la bonificación post-presentación (labor_discount_percent/material_discount_percent
 * del budget, ver FLOWS.md) al TOTAL agregado de cada sección — no toca estimated_total ni
 * total_price de cada línea individual, que siguen siendo el valor "bruto" original.
 */
function computeTotalsByCurrency(budget, laborLines, materialItems) {
  const laborFactor = 1 - (parseFloat(budget.labor_discount_percent || 0) / 100);
  const materialFactor = 1 - (parseFloat(budget.material_discount_percent || 0) / 100);

  const totals = { ARS: 0, USD: 0 };
  for (const line of laborLines) {
    const currency = line.currency || budget.currency;
    totals[currency] = (totals[currency] || 0) + parseFloat(line.estimated_total || 0) * laborFactor;
  }
  for (const item of materialItems) {
    const currency = item.currency || budget.currency;
    totals[currency] = (totals[currency] || 0) + parseFloat(item.total_price || 0) * materialFactor;
  }
  return totals;
}

module.exports = { computeTotalsByCurrency };
