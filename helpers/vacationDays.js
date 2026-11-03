"use strict";
// Días de vacaciones que corresponden por antigüedad (LCT art. 150). Estaba duplicada en
// leaveRequestController y selfServiceController; se usa también al calcular las vacaciones no
// gozadas de un egreso (helpers/terminationCalculations.js), que necesita el año del egreso.

/**
 * La ley computa la antigüedad al 31 de diciembre del año de referencia.
 * @param {string|Date|null} hireDate
 * @param {number} [referenceYear] - por defecto, el año actual
 * @returns {number} 14 / 21 / 28 / 35
 */
function calculateVacationDays(hireDate, referenceYear = new Date().getFullYear()) {
  if (!hireDate) return 0;

  const computeDate = new Date(referenceYear, 11, 31);
  const hire = new Date(hireDate);

  const diffTime = Math.abs(computeDate - hire);
  const diffYears = diffTime / (1000 * 60 * 60 * 24 * 365.25);

  if (diffYears <= 5) return 14;
  if (diffYears <= 10) return 21;
  if (diffYears <= 20) return 28;
  return 35;
}

module.exports = { calculateVacationDays };
