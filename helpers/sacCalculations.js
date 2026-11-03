// Cálculo puro (sin DB) del SAC / aguinaldo — ver PLAN_SAC.md §4 y §5.
// Todo es bruto: no hay cargas sociales. Los callers (payrollController, etapas 2 y 3) traen las
// entries y las líneas de la base y se las pasan ya armadas a estas funciones.
const { round2 } = require("./payrollCalculations");

const pad = (n) => String(n).padStart(2, "0");

// `DATEONLY` llega como string "YYYY-MM-DD"; se acepta también un Date. Todo se calcula en UTC
// para que el huso horario del server no corra un día.
function toIsoDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function parseUtc(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const daysBetweenInclusive = (startIso, endIso) => Math.round((parseUtc(endIso) - parseUtc(startIso)) / DAY_MS) + 1;

/** 1 para ene–jun, 2 para jul–dic. */
function semesterOfMonth(month) {
  return Number(month) <= 6 ? 1 : 2;
}

/**
 * Límites del semestre. Los días salen de las fechas reales (181/182 el 1ro, 184 el 2do), no de
 * una constante, para que el año bisiesto se resuelva solo.
 * @returns {{ year: number, semester: 1|2, start: string, end: string, months: number[], days: number }}
 */
function semesterBounds(year, semester) {
  const first = semester === 1;
  const start = `${year}-${first ? "01-01" : "07-01"}`;
  const end = `${year}-${first ? "06-30" : "12-31"}`;
  return {
    year,
    semester,
    start,
    end,
    months: first ? [1, 2, 3, 4, 5, 6] : [7, 8, 9, 10, 11, 12],
    days: daysBetweenInclusive(start, end),
  };
}

/** "SAC 1er semestre 2026" / "SAC 2do semestre 2026" — texto de la línea `sac`. */
function sacLabel(year, semester) {
  return `SAC ${semester === 1 ? "1er" : "2do"} semestre ${year}`;
}

/** "Diferencia SAC 1er sem. 2026" — texto de la línea `sac_adjustment`. */
function sacAdjustmentLabel(year, semester) {
  return `Diferencia SAC ${semester === 1 ? "1er" : "2do"} sem. ${year}`;
}

/**
 * Días del semestre que le corresponden al empleado: desde `max(ingreso, inicio del semestre)`
 * hasta el fin del semestre (o la fecha de egreso, si se pasa — queda listo para el plan de
 * bajas). Faltas y licencias no restan días.
 * @param {string|Date|null} hireDate
 * @param {number} year
 * @param {1|2} semester
 * @param {string|Date|null} [terminationDate]
 * @returns {number}
 */
function computableDays(hireDate, year, semester, terminationDate = null) {
  const bounds = semesterBounds(year, semester);
  const hire = toIsoDate(hireDate);
  const termination = toIsoDate(terminationDate);
  const from = hire && hire > bounds.start ? hire : bounds.start;
  const to = termination && termination < bounds.end ? termination : bounds.end;
  if (from > to) return 0;
  return daysBetweenInclusive(from, to);
}

/**
 * Remuneración mensual devengada de cada mes del semestre (PLAN_SAC.md §4.1).
 *
 * Por entry (se ignoran las de períodos `sac`: el aguinaldo no integra su propia base):
 *   remuneración = gross_amount
 *                − premios no remunerativos
 *                − líneas `sac_adjustment`
 *                − líneas `retroactive`           (se re-imputan, ver abajo)
 * y cada línea `retroactive` se suma al mes devengado (`source_month`/`source_year`) si cae en el
 * semestre — aunque la entry que la pagó sea de un mes o un semestre posterior.
 *
 * El caller trae solo entries confirmed/paid y puede pasar entries de fuera del semestre (las de
 * meses posteriores aportan sus retroactivos).
 *
 * @param {Array<{
 *   month: number, year: number, period_type: string, gross_amount: number|string,
 *   adjustments?: Array<{type: string, amount: number|string, is_remunerative?: boolean}>,
 *   lines?: Array<{line_type: string, subtotal: number|string, source_month?: number|null, source_year?: number|null}>
 * }>} entries
 * @param {number} year
 * @param {1|2} semester
 * @returns {Array<{ month: number, amount: number, gross: number, nonRemunerative: number,
 *   sacAdjustments: number, retroRemoved: number, retroAdded: number }>} un item por mes del semestre
 */
function monthlyRemuneration(entries, year, semester) {
  const { months } = semesterBounds(year, semester);
  return remunerationForMonths(entries, months.map((month) => ({ year, month })))
    .map(({ year: _year, ...rest }) => rest);
}

/**
 * Mismo cálculo que `monthlyRemuneration`, pero para una lista cualquiera de meses (puede cruzar
 * años). Lo usa también la base de la indemnización de un egreso (los últimos 12 meses).
 * `excludeLineTypes` resta además las líneas de esos tipos del mes en que se pagaron (ej:
 * `vacation`, que no integra la base del art. 245).
 * @param {Array} entries - mismo formato que `monthlyRemuneration`
 * @param {Array<{year: number, month: number}>} monthKeys
 * @param {{ excludeLineTypes?: string[] }} [options]
 * @returns {Array<{ year: number, month: number, amount: number, gross: number, nonRemunerative: number,
 *   sacAdjustments: number, excludedLines: number, retroRemoved: number, retroAdded: number }>} un item por mes, en el orden pedido
 */
function remunerationForMonths(entries, monthKeys, { excludeLineTypes = [] } = {}) {
  const keyOf = (y, m) => `${Number(y)}-${Number(m)}`;
  const byMonth = new Map(monthKeys.map(({ year, month }) => [
    keyOf(year, month),
    { year, month, amount: 0, gross: 0, nonRemunerative: 0, sacAdjustments: 0, excludedLines: 0, retroRemoved: 0, retroAdded: 0 },
  ]));

  for (const entry of entries || []) {
    if (entry.period_type === "sac") continue;

    const lines = entry.lines || [];
    const retroLines = lines.filter((l) => l.line_type === "retroactive");

    const ownMonth = byMonth.get(keyOf(entry.year, entry.month));
    if (ownMonth) {
      const nonRemunerative = (entry.adjustments || [])
        .filter((a) => a.type === "bonus" && a.is_remunerative === false)
        .reduce((s, a) => s + parseFloat(a.amount), 0);
      const sacAdjustments = lines
        .filter((l) => l.line_type === "sac_adjustment")
        .reduce((s, l) => s + parseFloat(l.subtotal), 0);
      const excludedLines = lines
        .filter((l) => excludeLineTypes.includes(l.line_type))
        .reduce((s, l) => s + parseFloat(l.subtotal), 0);
      const retroRemoved = retroLines.reduce((s, l) => s + parseFloat(l.subtotal), 0);

      ownMonth.gross += parseFloat(entry.gross_amount || 0);
      ownMonth.nonRemunerative += nonRemunerative;
      ownMonth.sacAdjustments += sacAdjustments;
      ownMonth.excludedLines += excludedLines;
      ownMonth.retroRemoved += retroRemoved;
    }

    for (const line of retroLines) {
      const target = byMonth.get(keyOf(line.source_year, line.source_month));
      if (target) target.retroAdded += parseFloat(line.subtotal);
    }
  }

  return monthKeys.map(({ year, month }) => {
    const m = byMonth.get(keyOf(year, month));
    return {
      year,
      month,
      gross: round2(m.gross),
      nonRemunerative: round2(m.nonRemunerative),
      sacAdjustments: round2(m.sacAdjustments),
      excludedLines: round2(m.excludedLines),
      retroRemoved: round2(m.retroRemoved),
      retroAdded: round2(m.retroAdded),
      amount: round2(m.gross - m.nonRemunerative - m.sacAdjustments - m.excludedLines - m.retroRemoved + m.retroAdded),
    };
  });
}

/**
 * Monto del SAC: `mejor_mes / 2 × días computables / días del semestre`.
 * Ante un empate de meses queda el primero (el desglose muestra uno solo).
 * @param {Array<{month: number, amount: number}>} monthly - salida de `monthlyRemuneration`
 * @param {string|Date|null} hireDate
 * @param {number} year
 * @param {1|2} semester
 * @param {string|Date|null} [terminationDate]
 * @returns {{ amount: number, bestMonth: number|null, bestAmount: number, computableDays: number, semesterDays: number }}
 */
function calculateSac(monthly, hireDate, year, semester, terminationDate = null) {
  const semesterDays = semesterBounds(year, semester).days;
  const days = computableDays(hireDate, year, semester, terminationDate);

  let best = null;
  for (const m of monthly || []) {
    if (!best || m.amount > best.amount) best = m;
  }
  const bestAmount = best && best.amount > 0 ? best.amount : 0;

  return {
    amount: bestAmount > 0 ? round2((bestAmount / 2) * (days / semesterDays)) : 0,
    bestMonth: bestAmount > 0 ? best.month : null,
    bestAmount,
    computableDays: days,
    semesterDays,
  };
}

/**
 * Diferencia a favor del empleado entre el SAC recalculado y lo ya pagado (PLAN_SAC.md §5.2/§5.3).
 * Solo a favor: si da cero o negativo, devuelve 0 y no se hace nada.
 * @param {number} recalculated - SAC recalculado hoy
 * @param {number} paid - monto de la línea `sac` ya liquidada
 * @param {number} [adjustmentsPaid] - Σ líneas `sac_adjustment` ya pagadas de ese SAC
 */
function sacDifference(recalculated, paid, adjustmentsPaid = 0) {
  return Math.max(0, round2(Number(recalculated || 0) - Number(paid || 0) - Number(adjustmentsPaid || 0)));
}

module.exports = {
  semesterOfMonth,
  semesterBounds,
  sacLabel,
  sacAdjustmentLabel,
  computableDays,
  monthlyRemuneration,
  remunerationForMonths,
  calculateSac,
  sacDifference,
};
