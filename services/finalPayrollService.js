"use strict";
// Liquidación final de un egreso (PLAN_EGRESOS.md §6 y §7): genera la entry en un período `final`
// (uno por mes), deja corregir cada monto con motivo, descuenta adelantos y préstamos, y al
// confirmar/pagar cierra el trámite. Reutiliza PayrollEntry/PayrollLine/PayrollAdjustment, así que
// confirmar, pagar y el recibo con firma son los de cualquier liquidación.
const { Op } = require("sequelize");
const db = require("../models");
const { round2, computeNetAmount, sumAdjustments } = require("../helpers/payrollCalculations");
const { getUsdRateConfig } = require("../helpers/systemSettings");
const { fetchCurrentUsdRate } = require("./exchangeRateService");
const { recordAudit } = require("./auditLogService");
const { calculateTermination, computePendingAdvances, findOpenRequests } = require("./terminationCalculationService");
const {
  previewLoanSettlementFor, allocateSettlement, executeLoanSettlement, LoanSettlementError, todayLocalStr,
} = require("./loanSettlement");

/** Líneas que van en "Indemnizatorio / no remunerativo" del recibo; el resto es remunerativo. */
const INDEMNITY_LINE_TYPES = ["notice_pay", "notice_pay_sac", "month_integration", "month_integration_sac", "severance", "severance_agreed"];
/** Las únicas líneas que pueden tener un monto negativo (descuentos). */
const NEGATIVE_LINE_TYPES = ["overpaid_deduction", "employee_notice_deduction"];

/** Error de negocio con el status HTTP que el controller devuelve. */
class FinalPayrollError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "FinalPayrollError";
    this.status = status;
  }
}

const fmtDate = (iso) => iso.split("-").reverse().join("/");

/** Período `final` del mes (idempotente): un solo período por (year, month). */
async function ensureFinalPeriod(year, month, transaction) {
  const lastDay = new Date(year, month, 0).getDate();
  const pad = (n) => String(n).padStart(2, "0");
  const [period] = await db.PayPeriod.findOrCreate({
    where: { type: "final", year, month },
    defaults: { start_date: `${year}-${pad(month)}-01`, end_date: `${year}-${pad(month)}-${pad(lastDay)}` },
    transaction,
  });
  return period;
}

/** 15 días de sueldo (preaviso omitido por el trabajador): sueldo ÷ 30 en fijos, 8 h × valor hora en jornalizados. */
function employeeNoticeDeduction(employee) {
  let daily;
  if (employee.pay_type === "monthly") daily = Number(employee.monthly_salary || 0) / 30;
  else if (employee.pay_type === "biweekly_fixed") daily = (Number(employee.monthly_salary || 0) * 2) / 30;
  else daily = Number(employee.hourly_rate || 0) * 8;
  return -round2(daily * 15);
}

/**
 * Traduce el desglose del cálculo a las líneas de la liquidación final. Solo entran los conceptos
 * que aplican y no son "solo referencia" (mutuo acuerdo). Dos líneas existen aunque valgan cero,
 * porque son lo que el usuario edita: la gratificación pactada y el preaviso omitido por el
 * trabajador (sugerido, apagado por defecto).
 * @returns {Array<{ item_key: string, label: string, line_type: string, suggested_amount: number, amount: number }>}
 */
function buildFinalLines({ calculation, employee, termination }) {
  const lines = [];
  for (const item of calculation.items) {
    const b = item.breakdown || {};
    let lineType;
    let label = item.label;

    if (item.key === "wages") {
      if (item.amount === 0) continue;
      lineType = item.amount < 0 ? "overpaid_deduction" : "final_days";
      if (b.range) label = `${item.amount < 0 ? "Haberes pagados de más" : "Haberes"} del ${fmtDate(b.range.from)} al ${fmtDate(b.range.to)}`;
    } else if (item.key === "sac_proportional") {
      lineType = "sac_proportional";
      label = `${b.label} (proporcional)`;
    } else if (item.key.startsWith("sac_previous_")) {
      lineType = "sac_proportional";
    } else if (item.key === "vacation_unused") {
      lineType = "vacation_unused";
      label = `Vacaciones no gozadas (${b.unused_days} días)`;
    } else if (item.key === "severance_agreed") {
      lineType = "severance_agreed"; // se crea siempre en el mutuo acuerdo: la edita el usuario
    } else {
      lineType = item.key; // vacation_unused_sac, notice_pay(+_sac), month_integration(+_sac), severance
    }

    if (item.key === "severance_agreed") {
      if (item.reference_only) continue; // la gratificación se paga con el acuerdo de pago en cuotas
    } else if (!item.applies || item.reference_only || item.amount === 0) {
      continue;
    }
    lines.push({ item_key: item.key, label, line_type: lineType, suggested_amount: item.amount, amount: item.amount });
  }

  if (termination.type === "resignation" && termination.employee_notice_omitted) {
    lines.push({
      item_key: "employee_notice_deduction",
      label: "Preaviso omitido por el trabajador (15 días) — sugerido, apagado",
      line_type: "employee_notice_deduction",
      suggested_amount: employeeNoticeDeduction(employee),
      amount: 0,
    });
  }
  return lines;
}

/** Cotización del dólar para liquidar un préstamo en USD: la del día. `null` si no hace falta. */
async function resolveUsdRateIfNeeded(employeeId, transaction) {
  const usdLoans = await db.Loan.count({ where: { employee_id: employeeId, status: "active", currency: "USD" }, transaction });
  if (usdLoans === 0) return null;
  const current = await fetchCurrentUsdRate(await getUsdRateConfig());
  if (!current) {
    throw new FinalPayrollError("No se pudo obtener la cotización del dólar para liquidar el préstamo en dólares; intentá de nuevo en unos minutos.");
  }
  return current.rate;
}

/**
 * Reparte lo disponible entre los descuentos (PLAN_EGRESOS.md §6.2): primero adelantos (son sueldo
 * ya cobrado), la más vieja primero; después los préstamos de cuota fija, cuota por cuota. El neto
 * nunca baja de cero: lo que no entra queda como deuda pendiente. No toca la base.
 * @returns {Promise<{ advances: {covered: Array, uncovered: Array, total: number}, loans: Array, loans_total_ars: number }>}
 */
async function planDeductions({ employeeId, available, usdRate, transaction }) {
  let remaining = round2(Math.max(0, available));

  const pending = (await computePendingAdvances(employeeId)).items;
  const covered = [];
  const uncovered = [];
  let blocked = false;
  for (const advance of pending) {
    if (!blocked && advance.amount <= remaining + 0.001) {
      covered.push(advance);
      remaining = round2(remaining - advance.amount);
    } else {
      blocked = true; // respeta el orden: una que no entra no se saltea por una posterior más chica
      uncovered.push(advance);
    }
  }
  const advancesTotal = round2(covered.reduce((s, a) => s + a.amount, 0));

  const loans = [];
  const activeLoans = await db.Loan.findAll({
    where: { employee_id: employeeId, status: "active", plan_type: "fixed_installments" },
    order: [["id", "ASC"]],
    transaction,
  });
  for (const loan of activeLoans) {
    let preview;
    try {
      preview = await previewLoanSettlementFor(loan, { transaction });
    } catch (error) {
      if (error instanceof LoanSettlementError) continue;
      throw error;
    }
    const currency = loan.currency || "ARS";
    const allocation = allocateSettlement(preview.rows, remaining, usdRate, currency);
    remaining = round2(remaining - allocation.total_ars);
    loans.push({
      loan_id: loan.id,
      currency,
      installments: preview.rows.length,
      collected: allocation.count,
      complete: allocation.complete,
      total_ars: allocation.total_ars,
      full_total: preview.total,
    });
  }
  return { advances: { covered, uncovered, total: advancesTotal }, loans, loans_total_ars: round2(loans.reduce((s, l) => s + l.total_ars, 0)) };
}

/**
 * Recalcula la entry final a partir de sus líneas y ajustes: bruto, reparto de descuentos y neto.
 * Re-imputa los adelantos: los cubiertos quedan vinculados al período final, los que ya no entran
 * se desvinculan (vuelven a ser deuda pendiente).
 */
async function recomputeFinalEntry(entry, { usdRate = null, transaction } = {}) {
  const lines = await db.PayrollLine.findAll({ where: { payroll_entry_id: entry.id }, transaction });
  const adjustments = await db.PayrollAdjustment.findAll({ where: { payroll_entry_id: entry.id }, transaction });
  const { extras, deds, deposits } = sumAdjustments(adjustments);

  const gross_amount = round2(lines.reduce((s, l) => s + Number(l.subtotal), 0) + extras);
  const available = round2(gross_amount - deds - deposits);
  const plan = await planDeductions({ employeeId: entry.employee_id, available, usdRate, transaction });

  const coveredIds = plan.advances.covered.map((a) => a.id);
  if (coveredIds.length > 0) {
    await db.SalaryAdvance.update({ pay_period_id: entry.pay_period_id }, { where: { id: { [Op.in]: coveredIds } }, transaction });
  }
  await db.SalaryAdvance.update(
    { pay_period_id: null },
    { where: { employee_id: entry.employee_id, pay_period_id: entry.pay_period_id, ...(coveredIds.length ? { id: { [Op.notIn]: coveredIds } } : {}) }, transaction }
  );

  await entry.update({
    gross_amount,
    advances_deducted: plan.advances.total,
    loan_installments_deducted: plan.loans_total_ars,
    net_amount: computeNetAmount({ gross_amount, deds, deposits, advances_deducted: plan.advances.total, loan_installments_deducted: plan.loans_total_ars }),
  }, { transaction });
  return plan;
}

/** Entry final de un egreso, con sus líneas. */
async function loadFinalEntry(termination, transaction) {
  if (!termination.final_payroll_entry_id) return null;
  return db.PayrollEntry.findByPk(termination.final_payroll_entry_id, {
    include: [{ model: db.PayrollLine, as: "lines" }, { model: db.PayPeriod, as: "payPeriod", attributes: ["id", "type", "month", "year"] }],
    order: [[{ model: db.PayrollLine, as: "lines" }, "id", "ASC"]],
    transaction,
  });
}

/**
 * Genera (o regenera, mientras esté en borrador) la liquidación final de un egreso confirmado.
 * Regenerar respeta los montos que ya se corrigieron con motivo (se identifican por `item_key`).
 */
async function generateFinalPayroll(termination, { userId } = {}) {
  if (termination.status !== "confirmed") {
    throw new FinalPayrollError("El egreso tiene que estar confirmado para generar la liquidación final.");
  }
  const existing = termination.final_payroll_entry_id ? await db.PayrollEntry.findByPk(termination.final_payroll_entry_id) : null;
  if (existing && existing.status !== "draft") {
    throw new FinalPayrollError("La liquidación final ya está confirmada: no se puede regenerar.");
  }

  const employee = await db.Employee.findByPk(termination.employee_id);
  const calculation = await calculateTermination(termination);
  const usdRate = await resolveUsdRateIfNeeded(employee.id);
  const [ty, tm] = termination.termination_date.split("-").map(Number);

  const t = await db.sequelize.transaction();
  try {
    const period = await ensureFinalPeriod(ty, tm, t);

    const previous = existing
      ? await db.PayrollLine.findAll({ where: { payroll_entry_id: existing.id }, transaction: t })
      : [];
    const edited = new Map(previous.filter((l) => l.edit_reason).map((l) => [l.item_key, l]));

    let entry = existing;
    const base = {
      pay_period_id: period.id,
      employee_id: employee.id,
      total_regular_hours: 0, total_overtime_50_hours: 0, total_overtime_100_hours: 0,
      regular_amount: 0, overtime_50_amount: 0, overtime_100_amount: 0,
      late_count: 0, absent_count: 0,
    };
    if (entry) {
      await entry.update(base, { transaction: t });
    } else {
      entry = await db.PayrollEntry.create({ ...base, status: "draft" }, { transaction: t });
    }

    await db.PayrollLine.destroy({ where: { payroll_entry_id: entry.id }, transaction: t });
    for (const line of buildFinalLines({ calculation, employee, termination })) {
      const carried = edited.get(line.item_key);
      const amount = carried ? Number(carried.subtotal) : line.amount;
      await db.PayrollLine.create({
        payroll_entry_id: entry.id,
        concept_id: null,
        label: line.label,
        quantity: 1,
        rate: amount,
        subtotal: amount,
        line_type: line.line_type,
        item_key: line.item_key,
        suggested_amount: line.suggested_amount,
        edit_reason: carried ? carried.edit_reason : null,
      }, { transaction: t });
    }

    await recomputeFinalEntry(entry, { usdRate, transaction: t });
    await termination.update({ final_payroll_entry_id: entry.id }, { transaction: t });

    await recordAudit({
      entityType: "PayrollEntry",
      entityId: entry.id,
      action: existing ? "update" : "create",
      fieldChanged: "gross_amount",
      newValue: entry.gross_amount,
      amount: entry.gross_amount,
      context: { employee_id: employee.id, pay_period_id: period.id, termination_id: termination.id, trigger: existing ? "regenerate_final" : "generate_final" },
      userId,
    }, t);

    await t.commit();
    return loadFinalEntry(termination);
  } catch (error) {
    await t.rollback();
    throw error;
  }
}

/** Corrige el monto de una línea de la liquidación final (en borrador), con motivo obligatorio. */
async function editFinalLine(termination, lineId, { amount, reason }, { userId } = {}) {
  const entry = termination.final_payroll_entry_id ? await db.PayrollEntry.findByPk(termination.final_payroll_entry_id) : null;
  if (!entry) throw new FinalPayrollError("El egreso todavía no tiene liquidación final.", 404);
  if (entry.status !== "draft") throw new FinalPayrollError("La liquidación final ya está confirmada: no se pueden corregir los montos.");

  const line = await db.PayrollLine.findOne({ where: { id: lineId, payroll_entry_id: entry.id } });
  if (!line || !line.item_key) throw new FinalPayrollError("Línea no encontrada.", 404);

  const value = Number(amount);
  if (amount === undefined || amount === null || amount === "" || !Number.isFinite(value)) {
    throw new FinalPayrollError("El monto es obligatorio.");
  }
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  if (!trimmed) throw new FinalPayrollError("El motivo de la corrección es obligatorio.");
  const negativeAllowed = NEGATIVE_LINE_TYPES.includes(line.line_type);
  if (negativeAllowed ? value > 0 : value < 0) {
    throw new FinalPayrollError(negativeAllowed ? "Esta línea es un descuento: el monto tiene que ser negativo o cero." : "El monto no puede ser negativo.");
  }

  const employee = await db.Employee.findByPk(entry.employee_id);
  const usdRate = await resolveUsdRateIfNeeded(employee.id);
  const t = await db.sequelize.transaction();
  try {
    const previous = Number(line.subtotal);
    await line.update({ quantity: 1, rate: round2(value), subtotal: round2(value), edit_reason: trimmed }, { transaction: t });
    await recomputeFinalEntry(entry, { usdRate, transaction: t });
    await recordAudit({
      entityType: "PayrollLine",
      entityId: line.id,
      action: "update",
      fieldChanged: "subtotal",
      previousValue: previous,
      newValue: round2(value),
      amount: round2(value),
      context: { employee_id: entry.employee_id, payroll_entry_id: entry.id, termination_id: termination.id, item_key: line.item_key, suggested_amount: line.suggested_amount },
      userId,
      notes: trimmed,
    }, t);
    await t.commit();
    return loadFinalEntry(termination);
  } catch (error) {
    await t.rollback();
    throw error;
  }
}

/** Borra la liquidación final en borrador (al anular el egreso). */
async function discardDraftFinalPayroll(termination, transaction) {
  if (!termination.final_payroll_entry_id) return;
  const entry = await db.PayrollEntry.findByPk(termination.final_payroll_entry_id, { transaction });
  if (!entry) return;
  await db.SalaryAdvance.update({ pay_period_id: null }, { where: { employee_id: entry.employee_id, pay_period_id: entry.pay_period_id }, transaction });
  await db.PayrollLine.destroy({ where: { payroll_entry_id: entry.id }, transaction });
  await db.PayrollAdjustment.destroy({ where: { payroll_entry_id: entry.id }, transaction });
  await entry.destroy({ transaction });
  await termination.update({ final_payroll_entry_id: null }, { transaction });
}

/** Egreso al que pertenece una entry, o null si es una liquidación común. */
const findTerminationOfEntry = (entryId, transaction) =>
  db.EmployeeTermination.findOne({ where: { final_payroll_entry_id: entryId }, transaction });

/**
 * Confirma la liquidación final: re-imputa los descuentos con los números de hoy, cobra los
 * préstamos (cuotas → prepaid) y deja la entry en `confirmed`. Bloquea si quedan pedidos de
 * adelanto o préstamos sin resolver.
 */
async function confirmFinalEntry(entry, { userId } = {}) {
  const termination = await findTerminationOfEntry(entry.id);
  if (!termination) throw new FinalPayrollError("Esta liquidación no pertenece a un egreso.");
  if (entry.status !== "draft") throw new FinalPayrollError("Solo se pueden confirmar liquidaciones en borrador.");

  const open = await findOpenRequests(entry.employee_id);
  if (open.advances > 0 || open.loans > 0) {
    const parts = [];
    if (open.advances > 0) parts.push(`${open.advances} adelanto(s) pendiente(s) de aprobar o rechazar`);
    if (open.loans > 0) parts.push(`${open.loans} préstamo(s) pedido(s) o aprobado(s) sin entregar`);
    throw new FinalPayrollError(`Antes de confirmar hay que resolver: ${parts.join(" y ")}.`);
  }

  const usdRate = await resolveUsdRateIfNeeded(entry.employee_id);
  const t = await db.sequelize.transaction();
  try {
    const locked = await db.PayrollEntry.findByPk(entry.id, { transaction: t });
    const plan = await recomputeFinalEntry(locked, { usdRate, transaction: t });

    for (const planned of plan.loans) {
      if (planned.collected === 0) continue;
      const loan = await db.Loan.findByPk(planned.loan_id, { transaction: t });
      await executeLoanSettlement({
        loan, transaction: t, userId, trigger: "final_payroll", payrollEntryId: locked.id, reason: "termination",
        installmentLimit: planned.complete ? null : planned.collected,
        usdRate: planned.currency === "USD" ? usdRate : null,
        notes: `Liquidación final del egreso #${termination.id}`,
      });
    }

    await locked.update({ status: "confirmed" }, { transaction: t });
    await recordAudit({
      entityType: "PayrollEntry",
      entityId: locked.id,
      action: "update",
      fieldChanged: "status",
      previousValue: "draft",
      newValue: "confirmed",
      amount: locked.net_amount,
      context: { employee_id: locked.employee_id, termination_id: termination.id, trigger: "confirm_final" },
      userId,
    }, t);
    await t.commit();
    return locked;
  } catch (error) {
    await t.rollback();
    throw error;
  }
}

/**
 * Qué le debe el empleado a la empresa después de la liquidación final: adelantos pagados que no
 * entraron y préstamos que siguen activos. Vacío una vez resuelta la deuda.
 */
async function computePendingDebt(termination) {
  const empty = { total_ars: 0, advances: { items: [], total: 0 }, loans: { items: [], total_ars: 0, has_usd: false, total_usd: 0 }, resolved: !!termination.debt_resolution };
  if (termination.debt_resolution || !termination.final_payroll_entry_id) return empty;
  const entry = await db.PayrollEntry.findByPk(termination.final_payroll_entry_id);
  if (!entry || entry.status === "draft") return empty;

  const advances = await computePendingAdvances(termination.employee_id);
  const loans = await db.Loan.findAll({ where: { employee_id: termination.employee_id, status: "active" }, order: [["id", "ASC"]] });
  const items = [];
  for (const loan of loans) {
    const currency = loan.currency || "ARS";
    let amount = round2(Number(loan.remaining_balance || 0));
    if (loan.plan_type === "fixed_installments") {
      try {
        amount = (await previewLoanSettlementFor(loan)).total;
      } catch (error) {
        if (!(error instanceof LoanSettlementError)) throw error;
      }
    }
    items.push({ loan_id: loan.id, kind: loan.plan_type, currency, amount });
  }
  const totalArs = round2(items.filter((i) => i.currency !== "USD").reduce((s, i) => s + i.amount, 0));
  const usd = items.filter((i) => i.currency === "USD");
  return {
    total_ars: round2(advances.total + totalArs),
    advances,
    loans: { items, total_ars: totalArs, has_usd: usd.length > 0, total_usd: round2(usd.reduce((s, i) => s + i.amount, 0)) },
    resolved: false,
  };
}

const debtIsOpen = (debt) => debt.total_ars > 0 || debt.loans.has_usd;

/** ¿Hay un acuerdo de pago activo con alguna cuota sin pagar? (PLAN_EGRESOS.md §7) */
async function hasOpenAgreement(terminationId, transaction) {
  const agreement = await db.TerminationAgreement.findOne({
    where: { termination_id: terminationId, status: "active" },
    include: [{ model: db.TerminationAgreementInstallment, as: "installments", attributes: ["paid_at"] }],
    transaction,
  });
  return !!agreement && agreement.installments.some((i) => !i.paid_at);
}

/** Pasa el egreso a `settled` cuando la liquidación final está pagada, no queda deuda sin resolver y las cuotas del acuerdo (si hay) están pagas. */
async function trySettleTermination(termination, { userId, transaction } = {}) {
  const fresh = await db.EmployeeTermination.findByPk(termination.id, { transaction });
  if (fresh.status !== "confirmed" || !fresh.final_payroll_entry_id) return fresh;
  const entry = await db.PayrollEntry.findByPk(fresh.final_payroll_entry_id, { transaction });
  if (!entry || entry.status !== "paid") return fresh;
  if (debtIsOpen(await computePendingDebt(fresh))) return fresh;
  if (await hasOpenAgreement(fresh.id, transaction)) return fresh;

  await fresh.update({ status: "settled" }, { transaction });
  await recordAudit({
    entityType: "EmployeeTermination", entityId: fresh.id, action: "update", fieldChanged: "status",
    previousValue: "confirmed", newValue: "settled", context: { employee_id: fresh.employee_id }, userId,
  }, transaction);
  return fresh;
}

/**
 * Al pagar la liquidación final: se corta el acceso al portal del empleado (decisión §13.3) y,
 * si no queda deuda, el egreso pasa a `settled`.
 */
async function onFinalEntryPaid(entry, { userId } = {}) {
  const termination = await findTerminationOfEntry(entry.id);
  if (!termination) return null;
  const employee = await db.Employee.findByPk(termination.employee_id);
  if (employee && employee.user_id) {
    const user = await db.User.findByPk(employee.user_id);
    if (user && user.id !== userId) await user.destroy();
  }
  return trySettleTermination(termination, { userId });
}

/**
 * Resuelve la deuda pendiente de una sola vez. "paid": el empleado devolvió la plata (los
 * préstamos se liquidan con un pago y los adelantos se anulan). "condoned": la empresa la
 * perdona, con motivo (las cuotas pasan a cancelled; los adelantos quedan como costo).
 */
async function resolveDebt(termination, { resolution, paymentMethod, notes }, { userId } = {}) {
  if (!["paid", "condoned"].includes(resolution)) throw new FinalPayrollError("La resolución tiene que ser 'paid' o 'condoned'.");
  const reason = typeof notes === "string" ? notes.trim() : "";
  if (resolution === "condoned" && !reason) throw new FinalPayrollError("El motivo de la condonación es obligatorio.");
  if (resolution === "paid" && !["efectivo", "transferencia"].includes(paymentMethod)) {
    throw new FinalPayrollError("Indicá cómo devolvió el empleado la plata (efectivo o transferencia).");
  }
  if (termination.debt_resolution) throw new FinalPayrollError("La deuda ya fue resuelta.");

  const debt = await computePendingDebt(termination);
  if (!debtIsOpen(debt)) throw new FinalPayrollError("El empleado no tiene deuda pendiente.");

  const usdRate = resolution === "paid" ? await resolveUsdRateIfNeeded(termination.employee_id) : null;
  const t = await db.sequelize.transaction();
  try {
    const today = todayLocalStr();
    for (const item of debt.loans.items) {
      const loan = await db.Loan.findByPk(item.loan_id, { transaction: t });
      if (loan.plan_type === "fixed_installments") {
        if (resolution === "paid") {
          await executeLoanSettlement({
            loan, transaction: t, userId, trigger: "debt_payment", reason: "termination", usdRate: item.currency === "USD" ? usdRate : null,
            notes: `Devolución del empleado — egreso #${termination.id}`,
          });
        } else {
          await db.LoanInstallment.update({ status: "cancelled" }, { where: { loan_id: loan.id, status: "scheduled" }, transaction: t });
          await loan.update({ remaining_balance: 0, status: "completed", updated_by: userId }, { transaction: t });
        }
      } else {
        if (resolution === "paid" && item.amount > 0) {
          await db.LoanPayment.create({
            loan_id: loan.id, amount: item.amount, date: today, created_by: userId, updated_by: userId,
            notes: `Devolución del empleado — egreso #${termination.id}`,
          }, { transaction: t });
        }
        await loan.update({ remaining_balance: 0, status: "completed", updated_by: userId }, { transaction: t });
      }
      await recordAudit({
        entityType: "Loan", entityId: loan.id, action: "update", fieldChanged: "status", previousValue: "active", newValue: "completed",
        amount: item.amount, context: { employee_id: loan.employee_id, trigger: resolution === "paid" ? "debt_payment" : "debt_condoned", termination_id: termination.id },
        userId, notes: reason || null,
      }, t);
    }

    if (resolution === "paid") {
      for (const advance of debt.advances.items) {
        await db.SalaryAdvance.update({
          status: "cancelled", cancelled_at: new Date(), cancelled_by: userId, cancellation_reason: `Devuelto por el empleado al egresar (egreso #${termination.id})`,
        }, { where: { id: advance.id }, transaction: t });
      }
    }

    await termination.update({
      debt_resolution: resolution,
      debt_resolved_amount: debt.total_ars,
      debt_resolved_at: new Date(),
      debt_resolved_by: userId,
      debt_payment_method: resolution === "paid" ? paymentMethod : null,
      debt_resolution_notes: reason || null,
    }, { transaction: t });

    await recordAudit({
      entityType: "EmployeeTermination", entityId: termination.id, action: "update", fieldChanged: "debt_resolution",
      newValue: resolution, amount: debt.total_ars, context: { employee_id: termination.employee_id, usd_total: debt.loans.total_usd }, userId, notes: reason || null,
    }, t);

    await trySettleTermination(termination, { userId, transaction: t });
    await t.commit();
    return termination;
  } catch (error) {
    await t.rollback();
    throw error;
  }
}

module.exports = {
  INDEMNITY_LINE_TYPES,
  FinalPayrollError,
  ensureFinalPeriod,
  buildFinalLines,
  planDeductions,
  recomputeFinalEntry,
  loadFinalEntry,
  generateFinalPayroll,
  editFinalLine,
  discardDraftFinalPayroll,
  findTerminationOfEntry,
  confirmFinalEntry,
  computePendingDebt,
  debtIsOpen,
  hasOpenAgreement,
  trySettleTermination,
  onFinalEntryPaid,
  resolveDebt,
};
