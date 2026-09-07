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

module.exports = { findActiveLoan };
