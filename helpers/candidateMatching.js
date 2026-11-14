"use strict";
const { Op } = require("sequelize");
const db = require("../models");
const { phoneKey } = require("./phone");

/**
 * Detección de duplicados y de relación con empleados para postulantes (ver FLOWS.md §59).
 *
 * Todo se CALCULA AL LEER, no se guarda: el vínculo con Employees depende de datos que cambian
 * (un egreso, un alta nueva) y una columna `is_former_employee` quedaría desactualizada.
 */

// Quita los separadores más comunes para comparar. REPLACE anidado (y no REGEXP_REPLACE) para que
// ande igual en cualquier versión de MySQL.
const CLEAN_PHONE_SQL =
  "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone,' ',''),'-',''),'(',''),')',''),'+',''),'.','')";

/**
 * "Ex-empleado" = tuvo legajo y ya no está: borrado, con fecha de egreso o inactivo. El egreso
 * confirmado deja `status: inactive` + `termination_date` (employeeTerminationController).
 */
function isFormerEmployee(employee) {
  return Boolean(employee.deletedAt || employee.termination_date || employee.status === "inactive");
}

const employeeSummary = (employee) => ({
  id: employee.id,
  name: employee.name,
  lastname: employee.lastname,
  status: employee.status,
  termination_date: employee.termination_date || null,
  deleted: Boolean(employee.deletedAt),
});

/**
 * Empleados (actuales o ex) que comparten DNI o CUIL con la persona. Solo identidad fuerte: un
 * email o teléfono repetido entre un postulante y un empleado no dice nada.
 * `exceptEmployeeId`: el empleado al que el propio candidato ya fue convertido (etapa 5) no cuenta.
 */
async function findEmployeeMatches({ dni, cuil, exceptEmployeeId = null }) {
  const conditions = [];
  if (dni) conditions.push({ dni });
  if (cuil) conditions.push({ cuil });
  if (conditions.length === 0) return { current: [], former: [] };

  const where = { [Op.or]: conditions };
  if (exceptEmployeeId) where.id = { [Op.ne]: exceptEmployeeId };

  // paranoid:false: un empleado dado de baja lógica sigue siendo un ex-empleado.
  const employees = await db.Employee.findAll({ where, paranoid: false });
  const current = [];
  const former = [];
  for (const employee of employees) {
    (isFormerEmployee(employee) ? former : current).push(employeeSummary(employee));
  }
  return { current, former };
}

/**
 * Otros postulantes que podrían ser la misma persona, con el motivo de cada coincidencia.
 * DNI y CUIL son identidad fuerte; email y teléfono son pistas (dos personas pueden compartir
 * teléfono de contacto), por eso el frontend los muestra como "posible duplicado".
 */
async function findCandidateDuplicates({ dni, cuil, email, phone, excludeId = null }) {
  const conditions = [];
  if (dni) conditions.push({ dni });
  if (cuil) conditions.push({ cuil });
  if (email) conditions.push({ email });
  const key = phoneKey(phone);
  if (key) {
    conditions.push(
      db.Sequelize.where(
        db.Sequelize.literal(`RIGHT(${CLEAN_PHONE_SQL}, ${key.length})`),
        key
      )
    );
  }
  if (conditions.length === 0) return [];

  const where = { [Op.or]: conditions };
  if (excludeId) where.id = { [Op.ne]: excludeId };

  const found = await db.Candidate.findAll({
    where,
    attributes: ["id", "name", "lastname", "dni", "cuil", "email", "phone"],
    order: [["id", "DESC"]],
    limit: 10,
  });

  return found.map((candidate) => {
    const matched_on = [];
    if (dni && candidate.dni === dni) matched_on.push("dni");
    if (cuil && candidate.cuil === cuil) matched_on.push("cuil");
    if (email && candidate.email && candidate.email.toLowerCase() === email.toLowerCase()) matched_on.push("email");
    if (key && phoneKey(candidate.phone) === key) matched_on.push("phone");
    return { ...candidate.toJSON(), matched_on };
  });
}

module.exports = { findEmployeeMatches, findCandidateDuplicates, isFormerEmployee };
