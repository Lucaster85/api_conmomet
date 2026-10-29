const { Op } = require("sequelize");
const db = require("../models");
const { quincenaIndex } = require("./loanAmortizationService");

/**
 * Cuotas de préstamo `fixed_installments` que le corresponde descontar a un empleado en la
 * liquidación de `period`. Trae dos grupos:
 *
 * (a) las que ya están vinculadas a esta misma liquidación (`existingEntryId`, caso "regenerar":
 *     hay que seguir sumándolas al total aunque ya estén descontadas);
 * (b) las `scheduled`, sin vincular, de préstamos `active` cuya quincena de vencimiento es la del
 *     período o ANTERIOR — es decir, las de esta quincena y las atrasadas (que se suman a la
 *     próxima liquidación que se genere). Las futuras no entran, ni tampoco las de préstamos
 *     `approved` que todavía no se entregaron.
 *
 * A un mensualizado (se liquida solo en 2ª quincena) esto le suma automáticamente las cuotas del
 * mes, incluso las que vencían en 1ª quincena.
 *
 * Cada fila viene con su `loan` incluido. Ordenadas por número de cuota.
 */
async function findDueLoanInstallments({ employeeId, period, existingEntryId = null, transaction } = {}) {
  const loanInclude = (loanWhere) => [{
    model: db.Loan,
    as: "loan",
    where: { employee_id: employeeId, plan_type: "fixed_installments", ...loanWhere },
    attributes: ["id", "employee_id", "remaining_balance", "num_installments", "status", "currency"],
  }];

  const linked = existingEntryId
    ? await db.LoanInstallment.findAll({
      where: { payroll_entry_id: existingEntryId },
      include: loanInclude({}),
      transaction,
    })
    : [];

  const periodIndex = quincenaIndex(period.year, period.month, period.type);
  const candidates = await db.LoanInstallment.findAll({
    where: { payroll_entry_id: null, status: "scheduled" },
    include: loanInclude({ status: "active" }),
    transaction,
  });
  const due = candidates.filter(
    (i) => quincenaIndex(i.due_year, i.due_month, i.due_period_type) <= periodIndex
  );

  const seen = new Set();
  return [...linked, ...due]
    .filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)))
    .sort((a, b) => a.installment_number - b.installment_number);
}

module.exports = { findDueLoanInstallments };
