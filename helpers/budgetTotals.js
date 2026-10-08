const { userHasPermission } = require("./permissions");

/**
 * Bruto, % de bonificación y neto de cada CONCEPTO (mano de obra / materiales) por moneda.
 * Es el cálculo base: computeTotalsByCurrency (totales del presupuesto) y Facturación
 * (billingService) parten del mismo número, para que "lo que se presupuestó" y "lo que se puede
 * facturar" nunca difieran.
 *
 * La bonificación post-presentación (labor_discount_percent/material_discount_percent del budget,
 * ver FLOWS.md) se aplica al TOTAL agregado de cada concepto, no a cada línea: estimated_total y
 * total_price de las líneas siguen siendo el valor "bruto" original.
 *
 * Devuelve { ARS: { labor: {gross, discount_percent, net}, materials: {...} }, USD: {...} }. Las
 * dos monedas están siempre presentes (en 0 si no hay nada) — nunca se netea ARS contra USD.
 */
function computeConceptTotals(budget, laborLines, materialItems) {
  const laborDiscount = parseFloat(budget.labor_discount_percent || 0);
  const materialDiscount = parseFloat(budget.material_discount_percent || 0);

  const empty = (discount) => ({ gross: 0, discount_percent: discount, net: 0 });
  const result = {
    ARS: { labor: empty(laborDiscount), materials: empty(materialDiscount) },
    USD: { labor: empty(laborDiscount), materials: empty(materialDiscount) },
  };

  for (const line of laborLines) {
    const currency = line.currency || budget.currency;
    if (!result[currency]) result[currency] = { labor: empty(laborDiscount), materials: empty(materialDiscount) };
    result[currency].labor.gross += parseFloat(line.estimated_total || 0);
  }
  for (const item of materialItems) {
    const currency = item.currency || budget.currency;
    if (!result[currency]) result[currency] = { labor: empty(laborDiscount), materials: empty(materialDiscount) };
    result[currency].materials.gross += parseFloat(item.total_price || 0);
  }

  for (const byConcept of Object.values(result)) {
    byConcept.labor.net = byConcept.labor.gross * (1 - laborDiscount / 100);
    byConcept.materials.net = byConcept.materials.gross * (1 - materialDiscount / 100);
  }
  return result;
}

/**
 * Suma estimated_total (mano de obra) y total_price (materiales) agrupados por moneda —
 * nunca se netea ARS contra USD. Usado tanto por budgetController (listado/detalle de
 * Presupuestos) como por projectController (pestaña "Presupuesto" del detalle de proyecto),
 * para no duplicar el cálculo en dos lugares.
 *
 * Ya viene neto de bonificación (ver computeConceptTotals).
 */
function computeTotalsByCurrency(budget, laborLines, materialItems) {
  const byConcept = computeConceptTotals(budget, laborLines, materialItems);
  const totals = { ARS: 0, USD: 0 };
  for (const [currency, concepts] of Object.entries(byConcept)) {
    totals[currency] = concepts.labor.net + concepts.materials.net;
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

module.exports = { computeConceptTotals, computeTotalsByCurrency, computeMaterialSubtotals, applyPriceVisibility };
