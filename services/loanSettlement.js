"use strict";
// Liquidación de un préstamo de cuota fija por baja del empleado (renuncia o despido) — NO es
// cancelación anticipada por elección del empleado, esa no existe. La cuota que está corriendo
// (o que quedó vencida sin descontarse) se cobra COMPLETA; las restantes, que todavía no llegaron
// a su quincena, se liquidan cobrando solo el capital: el interés de esas se perdona.
//
// Dos modos sobre la misma regla (PLAN_EGRESOS.md §6.2):
//  - `previewLoanSettlement`: puro, cuánto se cobraría hoy. Lo usa el desglose del egreso.
//  - `executeLoanSettlement`: crea los LoanPayment, pasa las cuotas a `prepaid` y el préstamo a
//    `completed`. Lo usa `POST /loans/:id/settle` y, desde la liquidación final, el egreso (que
//    puede cobrar solo las primeras N cuotas con `allocateSettlement`).
const { Loan, LoanPayment, LoanInstallment } = require("../models");
const { recordAudit } = require("./auditLogService");
const { quincenaOfDate, quincenaIndex } = require("./loanAmortizationService");
const { round2 } = require("../helpers/payrollCalculations");

/** Fecha de hoy 'YYYY-MM-DD' en hora local (no UTC: a la noche en Argentina UTC ya es "mañana"). */
const todayLocalStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Error con el status HTTP que el controller tiene que devolver. */
class LoanSettlementError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "LoanSettlementError";
    this.status = status;
  }
}

/**
 * ¿La cuota "corre" (o está vencida) a la fecha dada? En quincenal corre desde su quincena; la
 * cuota mensual corre todo su mes (se compara por mes, sin mirar la quincena).
 */
function isCurrentOrPast(loan, installment, todayStr) {
  const current = quincenaOfDate(todayStr);
  if (loan.installment_frequency === "biweekly") {
    return (
      quincenaIndex(installment.due_year, installment.due_month, installment.due_period_type) <=
      quincenaIndex(current.year, current.month, current.half)
    );
  }
  return (
    installment.due_year < current.year ||
    (installment.due_year === current.year && installment.due_month <= current.month)
  );
}

/**
 * Cuánto se cobraría por cada cuota pendiente. Puro: no toca la base.
 * @param {object} loan - `installment_frequency`, `currency`
 * @param {Array} installments - cuotas `scheduled` ordenadas por número
 * @param {string} [todayStr]
 * @returns {{ rows: Array<{installment: object, amount: number, interest_waived: number, full: boolean}>,
 *   total: number, interest_waived_total: number, currency: string }}
 */
function previewLoanSettlement(loan, installments, todayStr = todayLocalStr()) {
  const rows = installments.map((installment) => {
    const full = isCurrentOrPast(loan, installment, todayStr);
    const amount = full ? Number(installment.total_amount) : Number(installment.principal_amount);
    return {
      installment,
      amount: round2(amount),
      interest_waived: full ? 0 : round2(Number(installment.total_amount) - Number(installment.principal_amount)),
      full,
    };
  });
  return {
    rows,
    total: round2(rows.reduce((s, r) => s + r.amount, 0)),
    interest_waived_total: round2(rows.reduce((s, r) => s + r.interest_waived, 0)),
    currency: loan.currency || "ARS",
  };
}

/** Valida que el préstamo se pueda liquidar por baja y devuelve sus cuotas pendientes. */
async function loadSettleableInstallments(loan, transaction) {
  if (loan.plan_type !== "fixed_installments") {
    throw new LoanSettlementError("La liquidación por baja solo aplica a préstamos de cuota fija.");
  }
  if (loan.status !== "active") {
    throw new LoanSettlementError("Solo se puede liquidar un préstamo activo.");
  }
  const scheduled = await LoanInstallment.findAll({
    where: { loan_id: loan.id, status: "scheduled" },
    order: [["installment_number", "ASC"]],
    transaction,
  });
  if (scheduled.length === 0) {
    throw new LoanSettlementError("El préstamo no tiene cuotas pendientes para liquidar.");
  }
  return scheduled;
}

/**
 * Preview sobre un préstamo cargado de la base (valida igual que `execute`).
 * @param {Loan} loan
 */
async function previewLoanSettlementFor(loan, { todayStr, transaction } = {}) {
  const scheduled = await loadSettleableInstallments(loan, transaction);
  return previewLoanSettlement(loan, scheduled, todayStr);
}

/**
 * Reparte un presupuesto (en pesos) entre las cuotas de la vista previa, la más vieja primero, y
 * se frena en la primera que no entra (PLAN_EGRESOS.md §6.2). Puro.
 * @param {Array<{amount: number}>} rows - `previewLoanSettlement(...).rows`
 * @param {number} budgetArs
 * @param {number|null} [usdRate] - para convertir las cuotas de un préstamo en dólares
 * @param {string} [currency]
 * @returns {{ count: number, total_ars: number, complete: boolean }} `count` cuotas (las primeras) entran
 */
function allocateSettlement(rows, budgetArs, usdRate = null, currency = "ARS") {
  let remaining = Number(budgetArs);
  let count = 0;
  let total = 0;
  for (const row of rows) {
    const ars = currency === "USD" ? round2(row.amount * Number(usdRate)) : row.amount;
    if (ars > remaining + 0.001) break;
    remaining = round2(remaining - ars);
    total = round2(total + ars);
    count += 1;
  }
  return { count, total_ars: total, complete: count === rows.length };
}

/**
 * Liquida el préstamo: un LoanPayment por cuota, cuotas → `prepaid`, préstamo → `completed`.
 * Corre dentro de la transacción del caller.
 *
 * Con `installmentLimit` solo se cobran las primeras N cuotas (cuando los descuentos de la
 * liquidación final superan lo que se le debe al empleado): el préstamo sigue `active` con su
 * saldo reducido por el capital cobrado, y las cuotas que no entraron siguen `scheduled`.
 * @param {object} params
 * @param {Loan} params.loan
 * @param {object} params.transaction
 * @param {number} [params.userId]
 * @param {string} [params.reason]
 * @param {string} [params.notes]
 * @param {string} [params.trigger] - para el AuditLog ("settle", o el egreso que lo dispara)
 * @param {number} [params.payrollEntryId] - liquidación que cobra las cuotas (liquidación final)
 * @param {string} [params.todayStr]
 * @param {number|null} [params.installmentLimit]
 * @param {number|null} [params.usdRate] - cotización para un préstamo en dólares (cada pago guarda la suya)
 * @returns {Promise<{ total_charged: number, total_charged_ars: number, collected: number, complete: boolean }>}
 */
async function executeLoanSettlement({
  loan, transaction, userId, reason, notes, trigger = "settle", payrollEntryId = null,
  todayStr = todayLocalStr(), installmentLimit = null, usdRate = null,
}) {
  const scheduled = await loadSettleableInstallments(loan, transaction);
  const { rows } = previewLoanSettlement(loan, scheduled, todayStr);
  const chosen = installmentLimit === null ? rows : rows.slice(0, installmentLimit);
  const isUsd = (loan.currency || "ARS") === "USD";
  if (isUsd && chosen.length > 0 && !(Number(usdRate) > 0)) {
    throw new LoanSettlementError("Falta la cotización del dólar para liquidar un préstamo en dólares.");
  }

  let collectedPrincipal = 0;
  let totalCharged = 0;
  let totalChargedArs = 0;
  for (const { installment, amount, full } of chosen) {
    const amountArs = isUsd ? round2(amount * Number(usdRate)) : amount;
    const payment = await LoanPayment.create({
      loan_id: loan.id,
      loan_installment_id: installment.id,
      payroll_entry_id: payrollEntryId,
      amount,
      exchange_rate: isUsd ? Number(usdRate) : null,
      amount_ars: isUsd ? amountArs : null,
      date: todayStr,
      notes: notes || `Liquidación por baja — cuota ${installment.installment_number}/${loan.num_installments}${full ? "" : " (sin interés)"}`,
      created_by: userId,
      updated_by: userId,
    }, { transaction });

    await installment.update({
      status: "prepaid",
      deducted_at: todayStr,
      loan_payment_id: payment.id,
      ...(payrollEntryId ? { payroll_entry_id: payrollEntryId } : {}),
    }, { transaction });

    collectedPrincipal += Number(installment.principal_amount);
    totalCharged += amount;
    totalChargedArs += amountArs;
  }
  totalCharged = round2(totalCharged);
  totalChargedArs = round2(totalChargedArs);
  const complete = chosen.length === rows.length;

  const previousBalance = loan.remaining_balance;
  const newBalance = complete ? 0 : Math.max(0, round2(Number(previousBalance) - collectedPrincipal));
  await loan.update(
    { remaining_balance: newBalance, ...(complete ? { status: "completed" } : {}), updated_by: userId },
    { transaction }
  );

  await recordAudit({
    entityType: "Loan",
    entityId: loan.id,
    action: "update",
    fieldChanged: "remaining_balance",
    previousValue: previousBalance,
    newValue: newBalance,
    amount: totalCharged,
    context: { employee_id: loan.employee_id, reason: reason || "other", trigger, collected: chosen.length, of: rows.length },
    userId,
  }, transaction);

  return { total_charged: totalCharged, total_charged_ars: totalChargedArs, collected: chosen.length, complete };
}

module.exports = {
  todayLocalStr,
  LoanSettlementError,
  previewLoanSettlement,
  previewLoanSettlementFor,
  allocateSettlement,
  executeLoanSettlement,
};
