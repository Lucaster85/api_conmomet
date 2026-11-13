"use strict";
// Días de vacaciones de un empleado (LCT arts. 150 a 153). Estaba duplicada en leaveRequestController
// y selfServiceController; ahora las dos usan `calculateVacationEntitlement`.
//
//  - `calculateVacationDays` (art. 150): días por antigüedad, 14 / 21 / 28 / 35. Es el año COMPLETO;
//    también la usa el cálculo de vacaciones no gozadas de un egreso (helpers/terminationCalculations.js),
//    que ya prorratea por su cuenta — por eso no cambia.
//  - `calculateVacationEntitlement` (arts. 151 y 153): lo que le corresponde en un año dado. Con la
//    mitad o más de los días hábiles del año calendario trabajados, los días completos; si no, 1 día
//    cada 20 de trabajo efectivo. Solo afecta al que ingresó en ese mismo año: el resto trabaja el
//    año entero. La ley evalúa al cierre del año, así que se proyecta hasta el 31/12.

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

const DAYS_PER_PROPORTIONAL_DAY = 20;

const toIso = (d) => (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));
const toUtcMs = (iso) => {
  const [y, m, day] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, day);
};

/**
 * Días hábiles entre dos fechas (inclusive) según la semana laboral. Los feriados cuentan como
 * hábiles (el empleado normalmente trabajaría ese día) y los domingos no, aunque se trabajen como extra.
 * @param {string} fromIso - YYYY-MM-DD
 * @param {string} toIso_ - YYYY-MM-DD
 * @param {'mon_fri'|'mon_sat'} [workWeek]
 */
function countWorkdays(fromIso, toIso_, workWeek = "mon_sat") {
  const from = toUtcMs(fromIso);
  const to = toUtcMs(toIso_);
  if (to < from) return 0;
  const lastWorkDay = workWeek === "mon_fri" ? 5 : 6; // getUTCDay: 0 = domingo ... 6 = sábado
  const DAY = 24 * 60 * 60 * 1000;
  let count = 0;
  for (let t = from; t <= to; t += DAY) {
    const dow = new Date(t).getUTCDay();
    if (dow >= 1 && dow <= lastWorkDay) count += 1;
  }
  return count;
}

/**
 * Días de vacaciones que corresponden en `year`.
 * @param {object} params
 * @param {string|Date|null} params.hireDate
 * @param {number} [params.year] - por defecto, el año actual
 * @param {'mon_fri'|'mon_sat'} [params.workWeek]
 * @param {number} [params.unjustifiedAbsenceDays] - faltas injustificadas del año (no cuentan como trabajadas, art. 152)
 * @returns {{ days: number, full_days: number, is_proportional: boolean, worked_days: number, year_workdays: number, required_days: number }}
 */
function calculateVacationEntitlement({
  hireDate, year = new Date().getFullYear(), workWeek = "mon_sat", unjustifiedAbsenceDays = 0,
}) {
  const empty = { days: 0, full_days: 0, is_proportional: false, worked_days: 0, year_workdays: 0, required_days: 0 };
  if (!hireDate) return empty;

  const hire = toIso(hireDate);
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  if (hire > yearEnd) return empty; // todavía no ingresó en ese año

  const fullDays = calculateVacationDays(hireDate, year);
  const yearWorkdays = countWorkdays(yearStart, yearEnd, workWeek);
  const requiredDays = Math.ceil(yearWorkdays / 2);

  // Trabajó el año entero (o no hay forma de que no llegue a la mitad): días completos.
  if (hire <= yearStart) {
    return { days: fullDays, full_days: fullDays, is_proportional: false, worked_days: yearWorkdays, year_workdays: yearWorkdays, required_days: requiredDays };
  }

  const workedDays = Math.max(0, countWorkdays(hire, yearEnd, workWeek) - Math.max(0, unjustifiedAbsenceDays));
  if (workedDays >= requiredDays) {
    return { days: fullDays, full_days: fullDays, is_proportional: false, worked_days: workedDays, year_workdays: yearWorkdays, required_days: requiredDays };
  }

  return {
    days: Math.floor(workedDays / DAYS_PER_PROPORTIONAL_DAY),
    full_days: fullDays,
    is_proportional: true,
    worked_days: workedDays,
    year_workdays: yearWorkdays,
    required_days: requiredDays,
  };
}

module.exports = { calculateVacationDays, calculateVacationEntitlement, countWorkdays };
