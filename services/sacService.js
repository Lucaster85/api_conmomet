// Acceso a datos del SAC (aguinaldo): arma, desde la base, las entradas que espera
// helpers/sacCalculations.js. La matemática vive en el helper (sin DB); acá solo se leen
// entries/líneas/ajustes y se crea el período SAC. Ver PLAN_SAC.md §4 y §5.
const { Op } = require("sequelize");
const db = require("../models");
const {
  semesterBounds, semesterOfMonth, monthlyRemuneration, calculateSac, sacDifference, sacAdjustmentLabel,
} = require("../helpers/sacCalculations");
const { round2 } = require("../helpers/payrollCalculations");

const pad = (n) => String(n).padStart(2, "0");

/** Mes (6 | 12) con el que se identifica el período SAC de un semestre. */
const sacMonthOf = (semester) => (semester === 1 ? 6 : 12);

/** Fecha de hoy (YYYY-MM-DD) en hora de Argentina, la misma zona que usa la base. */
function todayArgentina(now = new Date()) {
  return new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Primer día en que se puede generar el SAC: el inicio de la 2Q del mes de cierre del semestre
 * (día 16 de junio / diciembre) — antes de eso la quincena todavía no empezó (PLAN_SAC.md §5.1).
 */
function sacGenerationStartDate(period) {
  return `${period.year}-${pad(period.month)}-16`;
}

async function findSacPeriod(year, semester, transaction) {
  return db.PayPeriod.findOne({ where: { type: "sac", year, month: sacMonthOf(semester) }, transaction });
}

/** Crea el período SAC del semestre si no existe (idempotente). */
async function ensureSacPeriod(year, semester, transaction) {
  const bounds = semesterBounds(year, semester);
  const [period, created] = await db.PayPeriod.findOrCreate({
    where: { type: "sac", year, month: sacMonthOf(semester) },
    defaults: { start_date: bounds.start, end_date: bounds.end },
    transaction,
  });
  return { period, created };
}

/**
 * Entries confirmed/paid de los empleados que importan para el SAC del semestre, ya en la forma
 * que consume `monthlyRemuneration`. Trae las de los meses del semestre y, además, las de
 * cualquier otro mes que hayan pagado un retroactivo devengado dentro del semestre.
 * @returns {Promise<Map<number, Array>>} employee_id → entries
 */
async function loadSemesterEntries({ year, semester, employeeIds, transaction }) {
  const byEmployee = new Map();
  if (!employeeIds || employeeIds.length === 0) return byEmployee;

  const bounds = semesterBounds(year, semester);
  const semesterPeriods = await db.PayPeriod.findAll({
    where: { year, month: { [Op.in]: bounds.months }, type: { [Op.ne]: "sac" } },
    attributes: ["id"],
    transaction,
  });
  const semesterPeriodIds = semesterPeriods.map((p) => p.id);

  const retroLines = semesterPeriodIds.length > 0
    ? await db.PayrollLine.findAll({
      where: { line_type: "retroactive", source_period_id: { [Op.in]: semesterPeriodIds } },
      attributes: ["payroll_entry_id"],
      transaction,
    })
    : [];
  const retroEntryIds = [...new Set(retroLines.map((l) => l.payroll_entry_id))];

  const entries = await db.PayrollEntry.findAll({
    where: {
      employee_id: { [Op.in]: employeeIds },
      status: { [Op.in]: ["confirmed", "paid"] },
      [Op.or]: [
        { pay_period_id: { [Op.in]: semesterPeriodIds } },
        { id: { [Op.in]: retroEntryIds } },
      ],
    },
    include: [
      { model: db.PayPeriod, as: "payPeriod", attributes: ["id", "type", "month", "year"], where: { type: { [Op.ne]: "sac" } }, required: true },
      { model: db.PayrollLine, as: "lines", attributes: ["line_type", "subtotal", "source_period_id"], required: false },
      { model: db.PayrollAdjustment, as: "adjustments", attributes: ["type", "label", "amount", "is_remunerative"], required: false },
    ],
    transaction,
  });

  const sourceIds = new Set();
  for (const entry of entries) {
    for (const line of entry.lines) {
      if (line.line_type === "retroactive" && line.source_period_id) sourceIds.add(line.source_period_id);
    }
  }
  const sourcePeriods = sourceIds.size > 0
    ? await db.PayPeriod.findAll({ where: { id: { [Op.in]: [...sourceIds] } }, attributes: ["id", "month", "year"], transaction })
    : [];
  const sourceById = new Map(sourcePeriods.map((p) => [p.id, p]));

  for (const entry of entries) {
    const shaped = {
      month: entry.payPeriod.month,
      year: entry.payPeriod.year,
      period_type: entry.payPeriod.type,
      gross_amount: entry.gross_amount,
      adjustments: entry.adjustments.map((a) => ({ type: a.type, label: a.label, amount: a.amount, is_remunerative: a.is_remunerative })),
      lines: entry.lines.map((l) => {
        const source = l.source_period_id ? sourceById.get(l.source_period_id) : null;
        return { line_type: l.line_type, subtotal: l.subtotal, source_month: source ? source.month : null, source_year: source ? source.year : null };
      }),
    };
    if (!byEmployee.has(entry.employee_id)) byEmployee.set(entry.employee_id, []);
    byEmployee.get(entry.employee_id).push(shaped);
  }
  return byEmployee;
}

/** ¿Tiene el empleado al menos una liquidación (confirmed/paid) en un mes del semestre? (§4.3) */
function hasSemesterEntry(entries, year, semester) {
  const { months } = semesterBounds(year, semester);
  return (entries || []).some((e) => Number(e.year) === year && months.includes(Number(e.month)));
}

/**
 * SAC calculado de un empleado + el desglose para la pantalla de administración (§4.2): el
 * desglose no se persiste, se arma al vuelo.
 * @param {object} params
 * @param {Array} params.entries - de `loadSemesterEntries` (más, opcionalmente, entries sin guardar)
 * @param {string|Date|null} params.hireDate
 * @param {string|Date|null} [params.terminationDate]
 */
function computeEmployeeSac({ entries, hireDate, year, semester, terminationDate = null }) {
  const monthly = monthlyRemuneration(entries, year, semester);
  const sac = calculateSac(monthly, hireDate, year, semester, terminationDate);

  const { months } = semesterBounds(year, semester);
  const bonuses = [];
  for (const entry of entries || []) {
    if (entry.period_type === "sac" || Number(entry.year) !== year || !months.includes(Number(entry.month))) continue;
    for (const adj of entry.adjustments || []) {
      if (adj.type !== "bonus") continue;
      bonuses.push({ month: Number(entry.month), label: adj.label, amount: Number(adj.amount), is_remunerative: adj.is_remunerative !== false });
    }
  }
  bonuses.sort((a, b) => a.month - b.month);

  return { ...sac, monthly, bonuses };
}


/**
 * Semestre cuyo SAC ya quedó atrás cuando se liquida `period` (disparador "siguiente liquidación",
 * PLAN_SAC.md §5.2): la 1Q de julio/enero para jornalizados y quincenales fijos, la 2Q para
 * mensualizados (que no tienen 1Q). Cualquier otro período devuelve null.
 * @returns {{ year: number, semester: 1|2 } | null}
 */
function semesterToReviewAfter(period, payType) {
  const expectedType = payType === "monthly" ? "second_half" : "first_half";
  if (period.type !== expectedType) return null;
  if (period.month === 7) return { year: period.year, semester: 1 };
  if (period.month === 1) return { year: period.year - 1, semester: 2 };
  return null;
}

/**
 * Diferencia a favor del empleado entre el SAC recalculado y lo ya liquidado, para un semestre
 * (PLAN_SAC.md §5.2/§5.3). Una sola función para los dos disparadores:
 *   diferencia = sac_recalculado − sac_liquidado − Σ líneas `sac_adjustment` de ese SAC ya cargadas
 * Devuelve null si el semestre no tiene un SAC liquidado (confirmed/paid) para el empleado: un
 * borrador se regenera en lugar de ajustarse, y sin SAC no hay nada que diferir.
 *
 * @param {object} params
 * @param {{ id: number, hire_date: string|Date|null }} params.employee
 * @param {number} params.year
 * @param {1|2} params.semester
 * @param {object} [params.extraEntry] - la liquidación que se está generando (todavía en borrador,
 *   así que no está en la base): `{ period, gross_amount, adjustments, lines }` con líneas
 *   `retroactive` identificadas por `source_period_id`.
 * @param {number|null} [params.excludeEntryId] - entry que se regenera: sus propias líneas
 *   `sac_adjustment` se recrean, no cuentan como ya cargadas.
 * @returns {Promise<{ amount: number, sacPeriod: object, paid: number, adjustmentsPaid: number, recalculated: number } | null>}
 */
async function pendingSacDifference({ employee, year, semester, extraEntry = null, excludeEntryId = null, transaction }) {
  const sacPeriod = await findSacPeriod(year, semester, transaction);
  if (!sacPeriod) return null;

  const sacEntry = await db.PayrollEntry.findOne({
    where: { employee_id: employee.id, pay_period_id: sacPeriod.id, status: { [Op.in]: ["confirmed", "paid"] } },
    include: [{ model: db.PayrollLine, as: "lines", attributes: ["line_type", "subtotal"], required: false }],
    transaction,
  });
  if (!sacEntry) return null;
  const paid = round2(sacEntry.lines.filter((l) => l.line_type === "sac").reduce((s, l) => s + Number(l.subtotal), 0));

  const entriesByEmployee = await loadSemesterEntries({ year, semester, employeeIds: [employee.id], transaction });
  const entries = [...(entriesByEmployee.get(employee.id) || [])];

  if (extraEntry) {
    const sourceIds = [...new Set(extraEntry.lines.filter((l) => l.line_type === "retroactive" && l.source_period_id).map((l) => l.source_period_id))];
    const sources = sourceIds.length > 0
      ? await db.PayPeriod.findAll({ where: { id: { [Op.in]: sourceIds } }, attributes: ["id", "month", "year"], transaction })
      : [];
    const sourceById = new Map(sources.map((p) => [p.id, p]));
    entries.push({
      month: extraEntry.period.month,
      year: extraEntry.period.year,
      period_type: extraEntry.period.type,
      gross_amount: extraEntry.gross_amount,
      adjustments: extraEntry.adjustments || [],
      lines: extraEntry.lines.map((l) => {
        const source = l.source_period_id ? sourceById.get(l.source_period_id) : null;
        return { line_type: l.line_type, subtotal: l.subtotal, source_month: source ? source.month : null, source_year: source ? source.year : null };
      }),
    });
  }

  const recalculated = computeEmployeeSac({ entries, hireDate: employee.hire_date, year, semester }).amount;
  const adjustmentsPaid = await sumSacAdjustments({ employeeId: employee.id, sacPeriodId: sacPeriod.id, excludeEntryId, transaction });

  return { amount: sacDifference(recalculated, paid, adjustmentsPaid), sacPeriod, paid, adjustmentsPaid, recalculated };
}

/** Σ de las líneas `sac_adjustment` de un SAC para un empleado (en cualquier estado de entry). */
async function sumSacAdjustments({ employeeId, sacPeriodId, excludeEntryId = null, transaction }) {
  const lines = await db.PayrollLine.findAll({
    where: {
      line_type: "sac_adjustment",
      source_period_id: sacPeriodId,
      ...(excludeEntryId ? { payroll_entry_id: { [Op.ne]: excludeEntryId } } : {}),
    },
    attributes: ["subtotal"],
    include: [{ model: db.PayrollEntry, as: "payrollEntry", attributes: [], where: { employee_id: employeeId }, required: true }],
    transaction,
  });
  return round2(lines.reduce((s, l) => s + Number(l.subtotal), 0));
}

/**
 * Líneas `sac_adjustment` que le corresponden a una liquidación que se está generando. Se evalúa
 * por semestre, una sola vez aunque lo disparen los dos motivos:
 *  - el período es la "siguiente liquidación" del empleado tras el semestre (§5.2);
 *  - la liquidación trae retroactivos devengados en un semestre cuyo SAC ya se liquidó (§5.3).
 * @param {object} params
 * @param {object} params.employee
 * @param {object} params.period - el PayPeriod de la liquidación (quincena)
 * @param {Array} params.lines - líneas de la liquidación ya armadas (con los retroactivos)
 * @param {number} params.grossAmount - bruto de esas líneas
 * @param {Array} [params.adjustments] - ajustes existentes de la entry
 * @param {number|null} [params.excludeEntryId]
 * @returns {Promise<Array>} líneas listas para PayrollLine.create (sin payroll_entry_id)
 */
async function buildSacAdjustmentLines({ employee, period, lines, grossAmount, adjustments = [], excludeEntryId = null, transaction }) {
  if (period.type === "sac") return [];

  const candidates = new Map();
  const after = semesterToReviewAfter(period, employee.pay_type);
  if (after) candidates.set(`${after.year}-${after.semester}`, after);

  const retroSourceIds = [...new Set(lines.filter((l) => l.line_type === "retroactive" && l.source_period_id).map((l) => l.source_period_id))];
  if (retroSourceIds.length > 0) {
    const sources = await db.PayPeriod.findAll({ where: { id: { [Op.in]: retroSourceIds }, type: { [Op.ne]: "sac" } }, attributes: ["month", "year"], transaction });
    for (const src of sources) {
      const candidate = { year: src.year, semester: semesterOfMonth(src.month) };
      candidates.set(`${candidate.year}-${candidate.semester}`, candidate);
    }
  }

  const result = [];
  for (const { year, semester } of candidates.values()) {
    const pending = await pendingSacDifference({
      employee, year, semester, excludeEntryId, transaction,
      extraEntry: { period, gross_amount: grossAmount, adjustments, lines },
    });
    if (!pending || pending.amount <= 0) continue;
    result.push({
      concept_id: null,
      label: sacAdjustmentLabel(year, semester),
      quantity: 1,
      rate: pending.amount,
      subtotal: pending.amount,
      line_type: "sac_adjustment",
      source_period_id: pending.sacPeriod.id,
    });
  }
  return result;
}

module.exports = {
  sacMonthOf,
  todayArgentina,
  sacGenerationStartDate,
  findSacPeriod,
  ensureSacPeriod,
  loadSemesterEntries,
  hasSemesterEntry,
  computeEmployeeSac,
  semesterToReviewAfter,
  pendingSacDifference,
  sumSacAdjustments,
  buildSacAdjustmentLines,
};
