// Acceso a datos del SAC (aguinaldo): arma, desde la base, las entradas que espera
// helpers/sacCalculations.js. La matemática vive en el helper (sin DB); acá solo se leen
// entries/líneas/ajustes y se crea el período SAC. Ver PLAN_SAC.md §4 y §5.
const { Op } = require("sequelize");
const db = require("../models");
const { semesterBounds, monthlyRemuneration, calculateSac } = require("../helpers/sacCalculations");

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

module.exports = {
  sacMonthOf,
  todayArgentina,
  sacGenerationStartDate,
  findSacPeriod,
  ensureSacPeriod,
  loadSemesterEntries,
  hasSemesterEntry,
  computeEmployeeSac,
};
