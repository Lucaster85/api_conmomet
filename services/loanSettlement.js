"use strict";
// Liquidación de un préstamo de cuota fija por baja del empleado (renuncia o despido) — NO es
// cancelación anticipada por elección del empleado, esa no existe. La cuota que está corriendo
// (o que quedó vencida sin descontarse) se cobra COMPLETA; las restantes, que todavía no llegaron
// a su quincena, se liquidan cobrando solo el capital: el interés de esas se perdona.
//
// Dos modos sobre la misma regla (PLAN_EGRESOS.md §6.2):
//  - `previewLoanSettlement`: puro, cuánto se cobraría hoy. Lo usa el desglose del egreso.
//  - `executeLoanSettlement`: crea los LoanPayment, pasa las cuotas a `prepaid` y el préstamo a
//    `completed`. Lo usa `POST /loans/:id/settle` y, desde la liquidación final, el egreso.
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
 * Liquida el préstamo: un LoanPayment por cuota, cuotas → `prepaid`, préstamo → `completed`.
 * Corre dentro de la transacción del caller.
 * @param {object} params
 * @param {Loan} params.loan
 * @param {object} params.transaction
 * @param {number} [params.userId]
 * @param {string} [params.reason]
 * @param {string} [params.notes]
 * @param {string} [params.trigger] - para el AuditLog ("settle", o el egreso que lo dispara)
 * @param {number} [params.payrollEntryId] - liquidación que cobra las cuotas (liquidación final)
 * @param {string} [params.todayStr]
 * @returns {Promise<{ total_charged: number }>}
 */
async function executeLoanSettlement({ loan, transaction, userId, reason, notes, trigger = "settle", payrollEntryId = null, todayStr = todayLocalStr() }) {
  const scheduled = await loadSettleableInstallments(loan, transaction);
  const { rows, total } = previewLoanSettlement(loan, scheduled, todayStr);

  for (const { installment, amount, full } of rows) {
    const payment = await LoanPayment.create({
      loan_id: loan.id,
      loan_installment_id: installment.id,
      payroll_entry_id: payrollEntryId,
      amount,
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
  }

  const previousBalance = loan.remaining_balance;
  await loan.update({ remaining_balance: 0, status: "completed", updated_by: userId }, { transaction });

  await recordAudit({
    entityType: "Loan",
    entityId: loan.id,
    action: "update",
    fieldChanged: "remaining_balance",
    previousValue: previousBalance,
    newValue: 0,
    amount: total,
    context: { employee_id: loan.employee_id, reason: reason || "other", trigger },
    userId,
  }, transaction);

  return { total_charged: total };
}

module.exports = {
  todayLocalStr,
  LoanSettlementError,
  previewLoanSettlement,
  previewLoanSettlementFor,
  executeLoanSettlement,
};
