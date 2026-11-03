"use strict";
// Cálculo puro (sin DB) de la liquidación de un egreso — ver PLAN_EGRESOS.md §1 y §5.
//
// Todo lo que sale de acá es una PROPUESTA: la Ley 27.802 tiene artículos suspendidos
// judicialmente y el contador valida antes de confirmar. Por eso cada función devuelve
// `{ amount, breakdown }`: el `breakdown` es lo que ve administración para controlar el número
// (igual que el desglose del SAC) y no va al recibo.
//
// Las fechas son strings 'YYYY-MM-DD' y se calculan en UTC para que el huso horario del server
// no corra un día. Los callers (services/terminationCalculationService.js) traen los datos de la
// base y se los pasan ya armados.
const { round2 } = require("./payrollCalculations");
const { remunerationForMonths } = require("./sacCalculations");

const DAY_MS = 24 * 60 * 60 * 1000;
const PROBATION_MONTHS = 6; // art. 92 bis (Ley Bases); el CCT puede extenderlo
const VACATION_DAYS_BASE = 25; // art. 155: valor del día de vacaciones de un fijo = sueldo / 25
const HOURS_PER_DAY = 8;
const FIXED_MONTH_DAYS = 30; // prorrateo de fijos: sueldo / 30 × días

const toUtcMs = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const toIso = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDaysIso = (iso, n) => toIso(toUtcMs(iso) + n * DAY_MS);
const daysBetweenInclusive = (fromIso, toIsoDate) => Math.round((toUtcMs(toIsoDate) - toUtcMs(fromIso)) / DAY_MS) + 1;
const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

// ---------------------------------------------------------------------------------------------
// Antigüedad

/**
 * Antigüedad hasta el último día trabajado (inclusive).
 * `years_for_severance` = años cumplidos + 1 si la fracción supera 3 meses (art. 245).
 * @returns {{ years: number, months: number, days: number, total_months: number,
 *   fraction_over_three_months: boolean, years_for_severance: number, in_probation: boolean }}
 */
function seniority(hireDate, terminationDate, { probationMonths = PROBATION_MONTHS } = {}) {
  const [hy, hm, hd] = hireDate.split("-").map(Number);
  // Fin exclusivo: el último día trabajado cuenta como trabajado.
  const [ey, em, ed] = addDaysIso(terminationDate, 1).split("-").map(Number);

  let years = ey - hy;
  let months = em - hm;
  let days = ed - hd;
  if (days < 0) {
    months -= 1;
    const prevMonth = em === 1 ? 12 : em - 1;
    const prevYear = em === 1 ? ey - 1 : ey;
    days += daysInMonth(prevYear, prevMonth);
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  years = Math.max(0, years);

  const fractionOverThree = months > 3 || (months === 3 && days > 0);
  const totalMonths = years * 12 + months;
  return {
    years,
    months,
    days,
    total_months: totalMonths,
    fraction_over_three_months: fractionOverThree,
    years_for_severance: years + (fractionOverThree ? 1 : 0),
    in_probation: totalMonths < probationMonths,
  };
}

// ---------------------------------------------------------------------------------------------
// Base de la indemnización

/**
 * Remuneración de cada uno de los últimos `months` meses (incluido el del egreso), para elegir
 * la mejor (art. 245: mejor remuneración mensual, normal y habitual). No integran la base: SAC,
 * diferencias de SAC, vacaciones y premios no remunerativos (ver `remunerationForMonths`).
 * @param {Array} entries - formato de sacCalculations (`loadEntriesByMonths`)
 * @returns {Array<{ year: number, month: number, amount: number, gross: number,
 *   nonRemunerative: number, sacAdjustments: number, excludedLines: number }>} del más viejo al más nuevo
 */
function severanceSeries(entries, endYear, endMonth, months = 12) {
  const keys = [];
  let y = endYear;
  let m = endMonth;
  for (let i = 0; i < months; i += 1) {
    keys.unshift({ year: y, month: m });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return remunerationForMonths(entries, keys, { excludeLineTypes: ["vacation"] });
}

/**
 * Mejor mes de la serie. Ante un empate queda el más reciente.
 * @returns {{ base: number, year: number|null, month: number|null }}
 */
function severanceBase(series) {
  let best = null;
  for (const item of series || []) {
    if (!best || item.amount >= best.amount) best = item;
  }
  if (!best || best.amount <= 0) return { base: 0, year: null, month: null };
  return { base: round2(best.amount), year: best.year, month: best.month };
}

// ---------------------------------------------------------------------------------------------
// Indemnizaciones (despido sin causa)

/**
 * Indemnización por antigüedad (art. 245): `min(base, tope) × años`, con un mínimo de 1 mes de
 * sueldo sobre la base sin tope. En período de prueba no corresponde.
 * @param {number} base
 * @param {number} years - `years_for_severance`
 * @param {number|null} [cap] - 3 × promedio del CCT aplicable (opcional)
 * @param {boolean} [inProbation]
 */
function severance(base, years, cap = null, inProbation = false) {
  const breakdown = { base, years, cap: cap ?? null, cap_applied: false, minimum_applied: false, in_probation: inProbation };
  if (inProbation || base <= 0) return { amount: 0, breakdown };

  const hasCap = cap !== null && cap !== undefined && Number(cap) > 0;
  const capped = hasCap ? Math.min(base, Number(cap)) : base;
  breakdown.cap_applied = hasCap && Number(cap) < base;
  breakdown.capped_base = round2(capped);

  let amount = capped * years;
  if (amount < base) {
    amount = base;
    breakdown.minimum_applied = true;
  }
  return { amount: round2(amount), breakdown };
}

/**
 * Meses de preaviso que corresponden (art. 231): 1 mes hasta 5 años de antigüedad, 2 si la
 * antigüedad es mayor.
 */
function noticeMonths(sen) {
  const over5 = sen.years > 5 || (sen.years === 5 && (sen.months > 0 || sen.days > 0));
  return over5 ? 2 : 1;
}

/**
 * Indemnización sustitutiva de preaviso (arts. 231/232). Solo despido sin causa. En período de
 * prueba no hay preaviso (27.802). Con preaviso parcial se paga la parte no otorgada, en
 * proporción a los días (mes = 30 días).
 * @param {number} base
 * @param {object} sen - salida de `seniority`
 * @param {'none'|'full'|'partial'} noticeGiven
 * @param {string} type - tipo de egreso
 * @param {{ start?: string|null, end?: string|null }} [noticeDates]
 */
function noticePay(base, sen, noticeGiven, type, noticeDates = {}) {
  const months = noticeMonths(sen);
  const breakdown = { base, months_entitled: months, notice_given: noticeGiven, applies: true, reason: null };

  if (type !== "dismissal_without_cause") return { amount: 0, breakdown: { ...breakdown, applies: false, reason: "Solo corresponde en el despido sin causa." } };
  if (sen.in_probation) return { amount: 0, breakdown: { ...breakdown, applies: false, reason: "Período de prueba: no hay preaviso." } };
  if (noticeGiven === "full") return { amount: 0, breakdown: { ...breakdown, applies: false, reason: "La empresa preavisó." } };
  if (base <= 0) return { amount: 0, breakdown };

  if (noticeGiven === "partial") {
    if (!noticeDates.start || !noticeDates.end) {
      return { amount: 0, breakdown: { ...breakdown, reason: "Preaviso parcial sin fechas: cargá el inicio y el fin del preaviso para calcular la diferencia." } };
    }
    const givenDays = daysBetweenInclusive(noticeDates.start, noticeDates.end);
    const entitledDays = months * 30;
    const missing = Math.max(0, 1 - givenDays / entitledDays);
    return {
      amount: round2(base * months * missing),
      breakdown: { ...breakdown, given_days: givenDays, entitled_days: entitledDays, missing_fraction: round2(missing) },
    };
  }

  return { amount: round2(base * months), breakdown };
}

/**
 * Integración del mes de despido (art. 233): `base / días del mes × días que faltan`, solo si no
 * hubo preaviso y el egreso no cae el último día del mes. Solo despido sin causa.
 */
function monthIntegration(base, terminationDate, noticeGiven, type, inProbation = false) {
  const [y, m, d] = terminationDate.split("-").map(Number);
  const monthDays = daysInMonth(y, m);
  const remaining = monthDays - d;
  const breakdown = { base, month_days: monthDays, remaining_days: remaining, applies: true, reason: null };

  if (type !== "dismissal_without_cause") return { amount: 0, breakdown: { ...breakdown, applies: false, reason: "Solo corresponde en el despido sin causa." } };
  if (inProbation) return { amount: 0, breakdown: { ...breakdown, applies: false, reason: "Período de prueba: no hay preaviso ni integración." } };
  if (noticeGiven !== "none") return { amount: 0, breakdown: { ...breakdown, applies: false, reason: "Hubo preaviso." } };
  if (remaining <= 0) return { amount: 0, breakdown: { ...breakdown, applies: false, reason: "El egreso es el último día del mes." } };
  if (base <= 0) return { amount: 0, breakdown };

  return { amount: round2((base / monthDays) * remaining), breakdown };
}

// ---------------------------------------------------------------------------------------------
// Vacaciones no gozadas

/**
 * Valor del día de vacaciones: `sueldo / 25` para fijos (art. 155; el quincenal fijo usa su
 * sueldo mensual equivalente, quincenal × 2) y `8 h × valor hora` para jornalizados.
 */
function vacationDailyRate(employee) {
  if (employee.pay_type === "monthly") return round2(Number(employee.monthly_salary || 0) / VACATION_DAYS_BASE);
  if (employee.pay_type === "biweekly_fixed") return round2((Number(employee.monthly_salary || 0) * 2) / VACATION_DAYS_BASE);
  return round2(Number(employee.hourly_rate || 0) * HOURS_PER_DAY);
}

/**
 * Vacaciones no gozadas (art. 156): `días que corresponden × días trabajados en el año / 365 −
 * días gozados del año`, mínimo 0, por el valor del día. Los días y el valor del día son
 * editables en la liquidación (Etapa 3).
 * @param {object} params
 * @param {number} params.correspondingDays
 * @param {number} params.takenDays
 * @param {string} params.hireDate
 * @param {string} params.terminationDate
 * @param {number} params.dailyRate
 */
function unusedVacation({ correspondingDays, takenDays, hireDate, terminationDate, dailyRate }) {
  const year = Number(terminationDate.slice(0, 4));
  const yearStart = `${year}-01-01`;
  const from = hireDate > yearStart ? hireDate : yearStart;
  const workedDays = from > terminationDate ? 0 : daysBetweenInclusive(from, terminationDate);

  const earned = round2((correspondingDays * workedDays) / 365);
  const days = Math.max(0, round2(earned - takenDays));
  return {
    amount: round2(days * dailyRate),
    breakdown: {
      year,
      corresponding_days: correspondingDays,
      worked_days_in_year: workedDays,
      earned_days: earned,
      taken_days: takenDays,
      unused_days: days,
      daily_rate: dailyRate,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// SAC sobre otros conceptos

/** SAC de un concepto (preaviso, integración, vacaciones no gozadas): `monto / 12`. */
function sacOn(amount) {
  return round2(Number(amount || 0) / 12);
}

// ---------------------------------------------------------------------------------------------
// Haberes del período no liquidado

/**
 * Rango de días sin liquidar: desde el día siguiente a la última quincena confirmada/pagada
 * hasta el egreso. Si esa quincena termina DESPUÉS del egreso (un fijo pagado de más), devuelve
 * el rango pagado de más (`overpaid: true`).
 * @param {object} params
 * @param {string|null} params.lastPaidEndDate - fin de la última quincena confirmada/pagada
 * @param {string} params.hireDate
 * @param {string} params.terminationDate
 * @returns {{ from: string, to: string, days: number, overpaid: boolean }}
 */
function unliquidatedRange({ lastPaidEndDate, hireDate, terminationDate }) {
  const from = lastPaidEndDate ? addDaysIso(lastPaidEndDate, 1) : hireDate;
  if (from > terminationDate) {
    const overFrom = addDaysIso(terminationDate, 1);
    return { from: overFrom, to: lastPaidEndDate, days: daysBetweenInclusive(overFrom, lastPaidEndDate), overpaid: true };
  }
  return { from, to: terminationDate, days: daysBetweenInclusive(from, terminationDate), overpaid: false };
}

/**
 * Prorrateo de un fijo: `sueldo mensual / 30 × días`, contando como máximo 30 días por mes
 * calendario (un mes completo sin liquidar vale exactamente el sueldo, tenga 28, 30 o 31 días).
 * El quincenal fijo entra con su sueldo mensual equivalente (quincenal × 2).
 * @returns {{ amount: number, days: number, months: Array<{year: number, month: number, days: number, counted_days: number}> }}
 */
function prorateFixedSalary(equivalentMonthlySalary, fromIso, toIsoDate) {
  const months = [];
  let cursor = fromIso;
  while (cursor <= toIsoDate) {
    const [y, m] = cursor.split("-").map(Number);
    const monthEnd = `${y}-${String(m).padStart(2, "0")}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
    const segmentEnd = monthEnd < toIsoDate ? monthEnd : toIsoDate;
    const days = daysBetweenInclusive(cursor, segmentEnd);
    months.push({ year: y, month: m, days, counted_days: Math.min(days, FIXED_MONTH_DAYS) });
    cursor = addDaysIso(segmentEnd, 1);
  }
  const counted = months.reduce((s, x) => s + x.counted_days, 0);
  return {
    amount: round2((Number(equivalentMonthlySalary || 0) / FIXED_MONTH_DAYS) * counted),
    days: months.reduce((s, x) => s + x.days, 0),
    months,
  };
}

// ---------------------------------------------------------------------------------------------
// Qué conceptos aplican a cada tipo de egreso (PLAN_EGRESOS.md §1)

const REFERENCE_ONLY_TYPES = ["mutual_agreement"]; // preaviso/integración/245 solo para negociar el monto

/**
 * Arma el desglose completo a partir de las piezas ya calculadas. No calcula nada nuevo: decide
 * qué entra en el total según el tipo de egreso y separa lo remunerativo de lo indemnizatorio.
 *
 * @param {object} p
 * @param {string} p.type
 * @param {{amount: number, ...}} p.wages - haberes del período no liquidado (puede ser negativo: pagados de más)
 * @param {{amount: number, ...}} p.sacProportional - SAC del semestre del egreso
 * @param {Array<{amount: number, label: string, ...}>} [p.sacPreviousSemesters]
 * @param {{amount: number, ...}} p.vacation
 * @param {{amount: number, ...}} p.notice
 * @param {{amount: number, ...}} p.integration
 * @param {{amount: number, ...}} p.severance
 * @param {number|null} [p.agreedSeverance] - gratificación pactada (mutuo acuerdo)
 * @param {{sac_on_vacation?: boolean, sac_on_notice?: boolean, sac_on_integration?: boolean}} [p.sacOnFlags]
 * @returns {{ items: Array, remunerative_total: number, indemnity_total: number, gross_total: number }}
 */
function assembleConcepts(p) {
  const flags = { sac_on_vacation: true, sac_on_notice: true, sac_on_integration: true, ...(p.sacOnFlags || {}) };
  const refOnly = REFERENCE_ONLY_TYPES.includes(p.type);

  const items = [];
  const push = (key, label, source, { group, reference_only = false, applies = true } = {}) => {
    items.push({
      key,
      label,
      group,
      amount: round2(source.amount || 0),
      applies,
      reference_only,
      breakdown: source.breakdown || source,
    });
  };

  push("wages", p.wages.amount < 0 ? "Haberes pagados de más" : "Haberes del período no liquidado", p.wages, { group: "remunerative" });
  push("sac_proportional", "SAC proporcional", p.sacProportional, { group: "remunerative" });
  for (const prev of p.sacPreviousSemesters || []) {
    push(`sac_previous_${prev.year}_${prev.semester}`, prev.label, prev, { group: "remunerative" });
  }
  push("vacation_unused", "Vacaciones no gozadas", p.vacation, { group: "remunerative" });
  if (flags.sac_on_vacation) {
    push("vacation_unused_sac", "SAC s/ vacaciones no gozadas", { amount: sacOn(p.vacation.amount), breakdown: { base: p.vacation.amount, divisor: 12 } }, { group: "remunerative" });
  }

  const noticeApplies = p.notice.breakdown?.applies !== false;
  const integrationApplies = p.integration.breakdown?.applies !== false;
  const severanceApplies = p.type === "dismissal_without_cause" || refOnly;

  // Preaviso, integración y art. 245 solo existen para el despido sin causa (y, como referencia
  // para negociar el monto, en el mutuo acuerdo): en los demás tipos ni se listan.
  if (p.type === "dismissal_without_cause" || refOnly) {
    push("notice_pay", "Indemnización sustitutiva de preaviso", p.notice, { group: "indemnity", reference_only: refOnly, applies: noticeApplies });
    if (flags.sac_on_notice) {
      push("notice_pay_sac", "SAC s/ preaviso", { amount: sacOn(p.notice.amount), breakdown: { base: p.notice.amount, divisor: 12 } }, { group: "indemnity", reference_only: refOnly, applies: noticeApplies });
    }
    push("month_integration", "Integración del mes de despido", p.integration, { group: "indemnity", reference_only: refOnly, applies: integrationApplies });
    if (flags.sac_on_integration) {
      push("month_integration_sac", "SAC s/ integración", { amount: sacOn(p.integration.amount), breakdown: { base: p.integration.amount, divisor: 12 } }, { group: "indemnity", reference_only: refOnly, applies: integrationApplies });
    }
    push("severance", "Indemnización por antigüedad (art. 245)", p.severance, { group: "indemnity", reference_only: refOnly, applies: severanceApplies });

    if (refOnly) {
      push(
        "severance_agreed",
        "Gratificación por cese pactada",
        { amount: p.agreedSeverance || 0, breakdown: { agreed: p.agreedSeverance ?? null, note: "Se carga con el acuerdo (etapa siguiente)." } },
        { group: "indemnity", applies: p.agreedSeverance != null }
      );
    }
  }

  const counts = (item) => item.applies && !item.reference_only;
  const total = (group) => round2(items.filter((i) => i.group === group && counts(i)).reduce((s, i) => s + i.amount, 0));
  const remunerative = total("remunerative");
  const indemnity = total("indemnity");
  return { items, remunerative_total: remunerative, indemnity_total: indemnity, gross_total: round2(remunerative + indemnity) };
}

module.exports = {
  PROBATION_MONTHS,
  seniority,
  severanceSeries,
  severanceBase,
  severance,
  noticeMonths,
  noticePay,
  monthIntegration,
  vacationDailyRate,
  unusedVacation,
  sacOn,
  unliquidatedRange,
  prorateFixedSalary,
  assembleConcepts,
};
