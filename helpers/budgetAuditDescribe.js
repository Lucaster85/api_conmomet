/**
 * Convierte una línea de presupuesto (BudgetLaborLine/BudgetMaterialItem, con sus includes de
 * etiqueta ya cargados) al objeto plano que se guarda en el historial (ver FLOWS.md §35, Etapa
 * 3) — usado tanto al escribir (budgetController.js, additionalController.js) como de
 * referencia para saber qué campos pela helpers/budgetTotals.js#peelAuditContext al leer.
 */

function describeLaborLine(line) {
  return {
    item_type: line.itemType?.name || null,
    description: line.description || null,
    quantity: parseFloat(line.quantity),
    // Gateados por budget_prices_read al leer el historial (ver peelAuditContext) — igual que
    // en la respuesta normal del presupuesto (helpers/budgetTotals.js#applyPriceVisibility).
    unit_price: line.unit_price !== null && line.unit_price !== undefined ? parseFloat(line.unit_price) : null,
    currency: line.currency,
    estimated_total: line.estimated_total !== null && line.estimated_total !== undefined ? parseFloat(line.estimated_total) : null,
  };
}

function describeMaterialLine(line) {
  return {
    description: line.description || null,
    quantity: parseFloat(line.quantity),
    material_unit: line.materialUnit?.label || null,
    provider: line.provider?.razonSocial || null,
    // Precio/margen de materiales NO dependen de budget_prices_read — los ve cualquiera con
    // acceso a Presupuestos, igual que en la respuesta normal (ver applyPriceVisibility).
    unit_price: line.unit_price !== null && line.unit_price !== undefined ? parseFloat(line.unit_price) : null,
    currency: line.currency,
    total_price: line.total_price !== null && line.total_price !== undefined ? parseFloat(line.total_price) : null,
    margin_percent: line.margin_percent !== null && line.margin_percent !== undefined ? parseFloat(line.margin_percent) : null,
    // Gateados por material_costs_read al leer el historial (ver peelAuditContext).
    material_cost_snapshot: line.material_cost_snapshot !== null && line.material_cost_snapshot !== undefined ? parseFloat(line.material_cost_snapshot) : null,
    material_cost_currency: line.material_cost_currency,
  };
}

module.exports = { describeLaborLine, describeMaterialLine };
