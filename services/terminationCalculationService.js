"use strict";
// Arma el desglose de la liquidación de un egreso (PLAN_EGRESOS.md §5): lee de la base lo que
// necesita (liquidaciones de los últimos 12 meses, horas, licencias, adelantos, préstamos) y se
// lo pasa a las funciones puras de helpers/terminationCalculations.js. Solo lectura: NO crea
// liquidaciones ni toca préstamos — eso es la Etapa 3. Todo monto es una propuesta a validar.
const { Op } = require("sequelize");
const db = require("../models");
const { round2, calculateMonthlyOvertimeAmount } = require("../helpers/payrollCalculations");
const { deductibleAdvanceWhere } = require("../helpers/salaryAdvanceScope");
const { calculateVacationDays } = require("../helpers/vacationDays");
const { semesterBounds, semesterOfMonth, sacLabel } = require("../helpers/sacCalculations");
const calc = require("../helpers/terminationCalculations");
const { loadEntriesByMonths, computeEmployeeSac, findSacPeriod, pendingSacDifference } = require("./sacService");
const { previewLoanSettlementFor, LoanSettlementError } = require("./loanSettlement");
const { NON_QUINCENA_TYPES } = require("../helpers/payPeriodTypes");

const MAX_REASONABLE_RANGE_DAYS = 62;

const monthKeysBefore = (year, month, count) => {
  const keys = [];
  let y = year;
  let m = month;
  for (let i = 0; i < count; i += 1) {
    keys.push({ year: y, month: m });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return keys;
};

const uniqueMonthKeys = (keys) => {
  const seen = new Set();
  return keys.filter(({ year, month }) => {
    const k = `${year}-${month}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/** Fin de la última quincena confirmada/pagada del empleado (sin contar aguinaldos). */
async function findLastPaidEndDate(employeeId) {
  const entry = await db.PayrollEntry.findOne({
    where: { employee_id: employeeId, status: { [Op.in]: ["confirmed", "paid"] } },
    include: [{ model: db.PayPeriod, as: "payPeriod", required: true, attributes: ["end_date"], where: { type: { [Op.notIn]: NON_QUINCENA_TYPES } } }],
    order: [[{ model: db.PayPeriod, as: "payPeriod" }, "end_date", "DESC"]],
  });
  return entry ? entry.payPeriod.end_date : null;
}

/**
 * Haberes del período no liquidado. Jornalizados: se reutiliza el motor de quincenas con un
 * período sintético recortado. Mensualizados y quincenales fijos: prorrateo `sueldo / 30 × días`
 * más las horas extra aprobadas del rango.
 */
async function computeWages(employee, termination) {
  const lastPaidEndDate = await findLastPaidEndDate(employee.id);
  const range = calc.unliquidatedRange({
    lastPaidEndDate,
    hireDate: employee.hire_date,
    terminationDate: termination.termination_date,
  });
  const warnings = [];
  const isFixed = employee.pay_type === "monthly" || employee.pay_type === "biweekly_fixed";
  const equivalentMonthly = employee.pay_type === "biweekly_fixed"
    ? Number(employee.monthly_salary || 0) * 2
    : Number(employee.monthly_salary || 0);

  const base = { last_paid_end_date: lastPaidEndDate, range };

  if (range.overpaid) {
    if (!isFixed) {
      return { amount: 0, breakdown: { ...base, lines: [], note: "La última quincena liquidada termina después del egreso." }, warnings };
    }
    const prorated = calc.prorateFixedSalary(equivalentMonthly, range.from, range.to);
    return {
      amount: -prorated.amount,
      breakdown: { ...base, method: "prorate_overpaid", equivalent_monthly_salary: equivalentMonthly, months: prorated.months, lines: [] },
      warnings: ["La última quincena liquidada termina después de la fecha de egreso: se sugiere descontar los días pagados de más."],
    };
  }

  if (range.days > MAX_REASONABLE_RANGE_DAYS) {
    warnings.push(`El rango sin liquidar es de ${range.days} días (${range.from} a ${range.to}): revisá que no falten quincenas por liquidar.`);
  }

  const { Attendance, Holiday, TimeEntry } = db;
  const between = { [Op.between]: [range.from, range.to] };
  const timeEntries = await TimeEntry.findAll({ where: { employee_id: employee.id, date: between, status: "approved" } });

  if (isFixed) {
    const prorated = calc.prorateFixedSalary(equivalentMonthly, range.from, range.to);
    const baseRate = await db.EmployeeRate.findOne({ where: { employee_id: employee.id, concept_id: null } });
    const overtime = calculateMonthlyOvertimeAmount(equivalentMonthly, baseRate ? baseRate.extras_rate : 0, timeEntries);
    return {
      amount: round2(prorated.amount + overtime.amount),
      breakdown: {
        ...base,
        method: "prorate_fixed",
        equivalent_monthly_salary: equivalentMonthly,
        months: prorated.months,
        prorated_amount: prorated.amount,
        overtime: { ot50_hours: overtime.ot50Hours, ot100_hours: overtime.ot100Hours, amount: overtime.amount },
        lines: [],
      },
      warnings,
    };
  }

  // Jornalizados: motor de quincenas con un período sintético que termina en el egreso.
  const { generateFlexibleLines } = require("../controllers/payrollController");
  const holidays = await Holiday.findAll({ where: { date: between } });
  const attendancesOf = (status) => Attendance.findAll({ where: { employee_id: employee.id, date: between, status } });
  const [vacation, medical, absent, justified] = await Promise.all(["vacation", "medical_leave", "absent", "justified"].map(attendancesOf));
  const concepts = await db.PayrollConcept.findAll({ attributes: ["id", "name"] });
  const result = await generateFlexibleLines(
    employee,
    { type: "first_half", start_date: range.from, end_date: range.to },
    timeEntries, holidays, vacation, medical, justified, absent,
    new Map(concepts.map((c) => [c.id, c]))
  );
  return {
    amount: round2(result.gross_amount),
    breakdown: {
      ...base,
      method: "engine",
      lines: result.lines.map((l) => ({ label: l.label, quantity: l.quantity, rate: l.rate, subtotal: l.subtotal, line_type: l.line_type })),
    },
    warnings,
  };
}

/** SAC del semestre del egreso, contando los haberes de la propia liquidación final en su mes. */
function computeSacProportional({ employee, termination, entries, wagesAmount }) {
  const [ty, tm] = termination.termination_date.split("-").map(Number);
  const semester = semesterOfMonth(tm);
  const semesterEntries = [...entries];
  if (wagesAmount > 0) {
    semesterEntries.push({ month: tm, year: ty, period_type: "second_half", gross_amount: wagesAmount, adjustments: [], lines: [] });
  }
  const sac = computeEmployeeSac({
    entries: semesterEntries, hireDate: employee.hire_date, year: ty, semester, terminationDate: termination.termination_date,
  });
  return {
    amount: sac.amount,
    breakdown: {
      label: sacLabel(ty, semester),
      year: ty,
      semester,
      best_month: sac.bestMonth,
      best_amount: sac.bestAmount,
      computable_days: sac.computableDays,
      semester_days: sac.semesterDays,
      monthly: sac.monthly.map((m) => ({ month: m.month, amount: m.amount })),
    },
  };
}

/**
 * SAC del semestre anterior que quedó sin liquidar (egreso en el primer mes del semestre, antes
 * de que se haya pagado). Si ya se liquidó, solo se suma la diferencia a favor, si la hay.
 */
async function computeSacPreviousSemester({ employee, termination, entries }) {
  const [ty, tm] = termination.termination_date.split("-").map(Number);
  if (tm !== 1 && tm !== 7) return [];

  const prev = tm === 7 ? { year: ty, semester: 1 } : { year: ty - 1, semester: 2 };
  const bounds = semesterBounds(prev.year, prev.semester);
  if (employee.hire_date > bounds.end) return [];

  const label = sacLabel(prev.year, prev.semester);
  const sacPeriod = await findSacPeriod(prev.year, prev.semester);
  const liquidated = sacPeriod
    ? await db.PayrollEntry.findOne({
      where: { employee_id: employee.id, pay_period_id: sacPeriod.id, status: { [Op.in]: ["confirmed", "paid"] } },
    })
    : null;

  if (liquidated) {
    const diff = await pendingSacDifference({ employee, year: prev.year, semester: prev.semester });
    if (!diff || diff.amount <= 0) return [];
    return [{
      year: prev.year, semester: prev.semester, label: `Diferencia ${label}`, amount: diff.amount,
      breakdown: { kind: "difference", recalculated: diff.recalculated, paid: diff.paid, adjustments_paid: diff.adjustmentsPaid },
    }];
  }

  const sac = computeEmployeeSac({ entries, hireDate: employee.hire_date, year: prev.year, semester: prev.semester });
  if (sac.amount <= 0) return [];
  return [{
    year: prev.year, semester: prev.semester, label: `${label} (sin liquidar)`, amount: sac.amount,
    breakdown: { kind: "unliquidated", best_month: sac.bestMonth, best_amount: sac.bestAmount, computable_days: sac.computableDays, semester_days: sac.semesterDays },
  }];
}

/**
 * Adelantos pagados que todavía no se descontaron. Se considera descontado el que está vinculado a
 * una quincena donde el empleado ya tiene una liquidación confirmada/pagada, o a una liquidación
 * en borrador de una quincena común (esa la va a descontar). El que está vinculado a la
 * liquidación final en borrador sí cuenta: es justamente lo que esa liquidación va a repartir.
 */
async function computePendingAdvances(employeeId) {
  const advances = await db.SalaryAdvance.findAll({
    where: { employee_id: employeeId, ...deductibleAdvanceWhere() },
    order: [["date", "ASC"], ["id", "ASC"]],
  });
  const periodIds = [...new Set(advances.map((a) => a.pay_period_id).filter(Boolean))];
  const entries = periodIds.length > 0
    ? await db.PayrollEntry.findAll({
      where: { employee_id: employeeId, pay_period_id: { [Op.in]: periodIds } },
      attributes: ["pay_period_id", "status"],
      include: [{ model: db.PayPeriod, as: "payPeriod", attributes: ["type"] }],
    })
    : [];
  const accountedPeriods = new Set(
    entries
      .filter((e) => e.status === "confirmed" || e.status === "paid" || e.payPeriod.type !== "final")
      .map((e) => e.pay_period_id)
  );
  const items = advances
    .filter((a) => !a.pay_period_id || !accountedPeriods.has(a.pay_period_id))
    .map((a) => ({ id: a.id, date: a.date, amount: round2(Number(a.amount)) }));
  return { items, total: round2(items.reduce((s, a) => s + a.amount, 0)) };
}

/** Préstamos activos: lo que se cobraría hoy por la baja (solo vista previa). */
async function computeLoanDiscounts(employeeId) {
  const loans = await db.Loan.findAll({ where: { employee_id: employeeId, status: "active" }, order: [["id", "ASC"]] });
  const items = [];
  for (const loan of loans) {
    const currency = loan.currency || "ARS";
    if (loan.plan_type === "fixed_installments") {
      try {
        const preview = await previewLoanSettlementFor(loan);
        items.push({
          loan_id: loan.id, kind: "fixed_installments", currency, amount: preview.total,
          installments: preview.rows.length, interest_waived: preview.interest_waived_total,
        });
      } catch (error) {
        if (!(error instanceof LoanSettlementError)) throw error;
      }
    } else {
      items.push({ loan_id: loan.id, kind: "discretionary", currency, amount: round2(Number(loan.remaining_balance || 0)), installments: 0, interest_waived: 0 });
    }
  }
  // Los préstamos en dólares se convierten con la cotización al generar la liquidación final.
  const totalArs = round2(items.filter((i) => i.currency !== "USD").reduce((s, i) => s + i.amount, 0));
  const usdItems = items.filter((i) => i.currency === "USD");
  return { items, total_ars: totalArs, has_usd: usdItems.length > 0, total_usd: round2(usdItems.reduce((s, i) => s + i.amount, 0)) };
}

/** Pedidos de adelanto / préstamo sin resolver: la liquidación final no los tendría en cuenta. */
async function findOpenRequests(employeeId) {
  const [advances, loans] = await Promise.all([
    db.SalaryAdvance.count({ where: { employee_id: employeeId, status: "pending" } }),
    db.Loan.count({ where: { employee_id: employeeId, status: { [Op.in]: ["pending", "approved"] } } }),
  ]);
  return { advances, loans };
}

/**
 * @param {EmployeeTermination} termination
 * @returns {Promise<object>} desglose completo (ver PLAN_EGRESOS.md §5)
 */
async function calculateTermination(termination) {
  const employee = await db.Employee.findByPk(termination.employee_id, {
    include: [{ model: db.Category, as: "category", attributes: ["id", "name", "guild_hourly_rate", "guild_id"] }],
  });
  const terminationDate = termination.termination_date;
  const [ty, tm] = terminationDate.split("-").map(Number);
  const semester = semesterOfMonth(tm);
  const prevSemester = semester === 1 ? { year: ty - 1, semester: 2 } : { year: ty, semester: 1 };

  const monthKeys = uniqueMonthKeys([
    ...monthKeysBefore(ty, tm, 12),
    ...semesterBounds(ty, semester).months.map((month) => ({ year: ty, month })),
    ...semesterBounds(prevSemester.year, prevSemester.semester).months.map((month) => ({ year: prevSemester.year, month })),
  ]);
  const entriesByEmployee = await loadEntriesByMonths({ monthKeys, employeeIds: [employee.id] });
  const entries = entriesByEmployee.get(employee.id) || [];

  const sen = calc.seniority(employee.hire_date, terminationDate);
  const series = calc.severanceSeries(entries, ty, tm);
  const base = calc.severanceBase(series);

  // En el mutuo acuerdo, preaviso / integración / art. 245 se calculan como si fuera un despido
  // sin causa, solo como referencia para negociar el monto.
  const refType = termination.type === "mutual_agreement" ? "dismissal_without_cause" : termination.type;
  const noticeGiven = termination.type === "mutual_agreement" ? "none" : termination.notice_given;
  const cap = termination.cct_cap_amount != null ? Number(termination.cct_cap_amount) : null;

  const notice = calc.noticePay(base.base, sen, noticeGiven, refType, { start: termination.notice_start_date, end: termination.notice_end_date });
  const integration = calc.monthIntegration(base.base, terminationDate, noticeGiven, refType, sen.in_probation);
  const severance = calc.severance(base.base, sen.years_for_severance, cap, sen.in_probation);

  const correspondingDays = employee.vacation_days_override != null
    ? employee.vacation_days_override
    : calculateVacationDays(employee.hire_date, ty);
  const takenDays = Number(await db.LeaveRequest.sum("total_days", {
    where: {
      employee_id: employee.id, leave_type: "vacation", status: "approved",
      start_date: { [Op.gte]: `${ty}-01-01`, [Op.lte]: `${ty}-12-31` },
    },
  }) || 0);
  const vacation = calc.unusedVacation({
    correspondingDays, takenDays, hireDate: employee.hire_date, terminationDate, dailyRate: calc.vacationDailyRate(employee),
  });

  const wages = await computeWages(employee, termination);
  const sacProportional = computeSacProportional({ employee, termination, entries, wagesAmount: wages.amount });
  const sacPreviousSemesters = await computeSacPreviousSemester({ employee, termination, entries });

  const concepts = calc.assembleConcepts({
    type: termination.type,
    wages, sacProportional, sacPreviousSemesters, vacation, notice, integration, severance,
  });

  const [advances, loans, openRequests] = await Promise.all([
    computePendingAdvances(employee.id),
    computeLoanDiscounts(employee.id),
    findOpenRequests(employee.id),
  ]);
  const deductionsTotal = round2(advances.total + loans.total_ars);

  const warnings = [...wages.warnings];
  if (base.base <= 0 && termination.type !== "resignation" && termination.type !== "dismissal_with_cause") {
    warnings.push("No hay liquidaciones confirmadas en los últimos 12 meses: la base de la indemnización quedó en cero.");
  }
  if (termination.type === "dismissal_without_cause" && noticeGiven === "partial" && !termination.notice_start_date) {
    warnings.push("El preaviso parcial no tiene fechas cargadas: el preaviso se calculó en cero.");
  }
  if (openRequests.advances > 0) warnings.push(`Hay ${openRequests.advances} pedido(s) de adelanto sin resolver.`);
  if (openRequests.loans > 0) warnings.push(`Hay ${openRequests.loans} préstamo(s) pedido(s) o aprobado(s) sin entregar.`);
  if (loans.has_usd) warnings.push("Hay un préstamo en dólares: se convierte a pesos con la cotización al generar la liquidación final.");

  const net = round2(concepts.gross_total - deductionsTotal);
  return {
    termination_id: termination.id,
    type: termination.type,
    termination_date: terminationDate,
    employee: {
      id: employee.id, name: employee.name, lastname: employee.lastname, pay_type: employee.pay_type, hire_date: employee.hire_date,
    },
    seniority: sen,
    severance_base: { ...base, series: series.map((m) => ({ year: m.year, month: m.month, amount: m.amount, gross: m.gross, non_remunerative: m.nonRemunerative, sac_adjustments: m.sacAdjustments, vacation: m.excludedLines })) },
    cct_cap_amount: cap,
    ...concepts,
    deductions: { advances, loans, total: deductionsTotal },
    net_estimate: Math.max(0, net),
    uncovered_debt: net < 0 ? round2(-net) : 0,
    warnings,
  };
}

module.exports = { calculateTermination, computePendingAdvances, findOpenRequests };
