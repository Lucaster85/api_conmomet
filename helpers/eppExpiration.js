// Calcula el vencimiento sugerido de una entrega de EPP a partir de su vida útil.
// Clampea al último día del mes destino en vez de desbordar (31/01 + 1 mes = 28/02, no 03/03,
// que es lo que haría `new Date(y, m+1, 31)` directo).
function addMonths(dateOnlyString, months) {
  const [year, month, day] = dateOnlyString.split("-").map(Number);
  const targetMonthIndex = month - 1 + months;
  const lastDayOfTargetMonth = new Date(year, targetMonthIndex + 1, 0).getDate();
  const clampedDay = Math.min(day, lastDayOfTargetMonth);
  const result = new Date(year, targetMonthIndex, clampedDay);

  const yyyy = result.getFullYear();
  const mm = String(result.getMonth() + 1).padStart(2, "0");
  const dd = String(result.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

module.exports = { addMonths };
