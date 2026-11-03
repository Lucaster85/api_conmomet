"use strict";
// Consultas compartidas por las guardas que rechazan operaciones sobre un empleado dado de baja
// (horas, adelantos, préstamos, edición manual del legajo). Ver PLAN_EGRESOS.md §9.
const { Op } = require("sequelize");
const db = require("../models");

// "Vigente" = no anulado. Un empleado tiene a lo sumo un egreso vigente.
const CURRENT_STATUSES = ["draft", "confirmed", "settled"];
// "Rige" = ya confirmado: el empleado quedó inactivo y empiezan a valer las guardas.
const IN_FORCE_STATUSES = ["confirmed", "settled"];

const findCurrentTermination = (employeeId, transaction) =>
  db.EmployeeTermination.findOne({
    where: { employee_id: employeeId, status: { [Op.in]: CURRENT_STATUSES } },
    transaction,
  });

const findTerminationInForce = (employeeId, transaction) =>
  db.EmployeeTermination.findOne({
    where: { employee_id: employeeId, status: { [Op.in]: IN_FORCE_STATUSES } },
    transaction,
  });

/**
 * Mensaje de error si el empleado tiene un egreso confirmado, o null si se puede operar.
 * `what` completa la frase: "No se le pueden otorgar adelantos".
 */
const terminationBlockMessage = async (employeeId, what, transaction) => {
  const termination = await findTerminationInForce(employeeId, transaction);
  if (!termination) return null;
  return `El empleado tiene un egreso confirmado (último día: ${termination.termination_date}). ${what}`;
};

module.exports = {
  CURRENT_STATUSES,
  IN_FORCE_STATUSES,
  findCurrentTermination,
  findTerminationInForce,
  terminationBlockMessage,
};
