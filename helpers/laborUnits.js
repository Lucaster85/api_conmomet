/**
 * Mano de obra por horas o por días. Un rubro "days" (BudgetItemType.unit_type) se carga y se
 * cotiza en días, y cada día vale HOURS_PER_DAY horas en la bolsa de horas del proyecto. Las
 * horas que cargan los empleados no cambian: descuentan de esa misma bolsa.
 */
const HOURS_PER_DAY = 9;

// hours_per_day viene de la línea (foto fija al crearla): null = la cantidad ya son horas.
const lineHours = (line) => {
  const quantity = parseFloat(line.quantity || 0);
  const perUnit = line.hours_per_day !== null && line.hours_per_day !== undefined ? parseFloat(line.hours_per_day) : 1;
  return quantity * perUnit;
};

const hoursPerDayFor = (itemType) => (itemType && itemType.unit_type === "days" ? HOURS_PER_DAY : null);

/**
 * Deja las líneas de un presupuesto (JSON plano) en el orden en que se cargaron — la numeración
 * del Detalle de mano de obra depende de él — y les agrega `hours` (horas cotizadas), para que el
 * frontend no repita la cuenta.
 */
const enrichLaborLines = (lines) =>
  [...(lines || [])]
    .sort((a, b) => a.id - b.id)
    .map((line) => ({ ...line, hours: lineHours(line) }));

module.exports = { HOURS_PER_DAY, lineHours, hoursPerDayFor, enrichLaborLines };
