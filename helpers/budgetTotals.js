const { userHasPermission } = require("./permissions");

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

/**
 * Subtotal "bruto" de materiales por moneda: suma total_price de las líneas visibles, SIN la
 * bonificación. Es lo que ve quien no tiene budget_prices_read (que no ve la bonificación ni la
 * mano de obra) — coincide con la suma de las líneas que sí ve.
 */
function computeMaterialSubtotals(budget, materialItems) {
  const totals = { ARS: 0, USD: 0 };
  for (const item of materialItems) {
    const currency = item.currency || budget.currency;
    totals[currency] = (totals[currency] || 0) + parseFloat(item.total_price || 0);
  }
  return totals;
}

/**
 * Qué parte de un presupuesto (ya en JSON plano) puede ver cada usuario. Compartido por
 * budgetController#withTotals y projectController (pestaña "Presupuesto" del proyecto) para no
 * duplicar la regla:
 *
 * - material_costs_read: el costo real de las líneas de material (snapshot).
 * - budget_prices_read: SOLO lo que toca la mano de obra — valores de mano de obra, el total
 *   general (que la incluye) y la bonificación. Los precios y el margen de los MATERIALES no
 *   dependen de este permiso: los ve y los carga cualquiera con acceso a Presupuestos. Quien no
 *   lo tiene recibe `materials_totals_by_currency` (subtotal de materiales) en vez de
 *   `totals_by_currency`.
 */
function applyPriceVisibility(data, user) {
  data.materials_totals_by_currency = computeMaterialSubtotals(data, data.materialItems || []);

  if (!userHasPermission(user, "material_costs_read")) {
    data.materialItems = (data.materialItems || []).map((item) => {
      const { material_cost_snapshot, material_cost_currency, ...rest } = item;
      return rest;
    });
  }

  if (!userHasPermission(user, "budget_prices_read")) {
    delete data.totals_by_currency;
    delete data.labor_discount_percent;
    delete data.material_discount_percent;
    data.laborLines = (data.laborLines || []).map((line) => {
      const { unit_price, currency, estimated_total, ...rest } = line;
      return rest;
    });
  }

  return data;
}

module.exports = { computeTotalsByCurrency, computeMaterialSubtotals, applyPriceVisibility };
