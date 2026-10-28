const db = require("../models");
const { Op } = require("sequelize");

// Reglas de negocio compartidas entre selfServiceController.requestLoan y
// loanController.create/approve — un solo lugar para no repetir (ni desincronizar) el criterio.

// "No se puede tomar un préstamo si se tiene otro activo" — aplica contra cualquier préstamo
// con status approved/active, sea `discretionary` o `fixed_installments` (la deuda es deuda,
// no importa el formato). Mismo conjunto de estados que ya usaba el `conflict_warning` de
// getAll, para no introducir un criterio nuevo.
async function findActiveLoan(employeeId, { transaction } = {}) {
  return db.Loan.findOne({
    where: { employee_id: employeeId, status: { [Op.in]: ["approved", "active"] } },
    transaction,
  });
}

// Reprogramar o cancelar un préstamo de cuota fija solo se permite si nunca se descontó nada —
// ni siquiera en una liquidación todavía en borrador (la cuota pasa a `deducted` y se vincula a
// la PayrollEntry/LoanPayment al GENERAR la liquidación, no al confirmarla). Devuelve un mensaje
// de bloqueo o `null` si está libre. La usan loanController.reschedule/cancel y getAll.
async function findLoanChangeBlocker(loan, { transaction } = {}) {
  if (loan.plan_type !== "fixed_installments") {
    return "Solo los préstamos de cuota fija se pueden reprogramar o cancelar.";
  }
  if (!["active", "approved"].includes(loan.status)) {
    return `No se puede modificar un préstamo en estado: ${loan.status}.`;
  }

  const touchedInstallment = await db.LoanInstallment.findOne({
    where: {
      loan_id: loan.id,
      [Op.or]: [
        { status: { [Op.ne]: "scheduled" } },
        { payroll_entry_id: { [Op.ne]: null } },
      ],
    },
    transaction,
  });
  if (touchedInstallment) {
    return "No se puede modificar: ya se descontó o vinculó alguna cuota de este préstamo.";
  }

  const existingPayment = await db.LoanPayment.findOne({ where: { loan_id: loan.id }, transaction });
  if (existingPayment) {
    return "No se puede modificar: el préstamo ya tiene pagos registrados.";
  }

  return null;
}

module.exports = { findActiveLoan, findLoanChangeBlocker };
