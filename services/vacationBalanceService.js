"use strict";
const { Op } = require("sequelize");
const db = require("../models");
const { calculateVacationEntitlement } = require("../helpers/vacationDays");
const { getWorkWeek } = require("../helpers/systemSettings");

/**
 * Saldo de vacaciones de un empleado en un año: lo que le corresponde, lo ya aprobado y lo que queda.
 * Lo usan el saldo del legajo (leaveRequestController#getBalance) y el del portal del empleado
 * (selfServiceController#getMyVacationBalance), que antes repetían el cálculo.
 *
 * `vacation_days_override` (el valor que se carga a mano en el legajo) siempre manda sobre la
 * escala legal y el proporcional. Ver FLOWS.md §55.
 *
 * @param {object} employee - fila de Employee
 * @param {number} [year] - por defecto, el año actual
 */
async function getVacationBalance(employee, year = new Date().getFullYear()) {
  const hasOverride = employee.vacation_days_override !== null && employee.vacation_days_override !== undefined;

  let entitlement;
  if (hasOverride) {
    entitlement = {
      days: employee.vacation_days_override, full_days: employee.vacation_days_override,
      is_proportional: false, worked_days: 0, year_workdays: 0, required_days: 0,
    };
  } else {
    const workWeek = await getWorkWeek();
    // Las faltas injustificadas solo importan si ingresó este año (el resto trabaja el año entero).
    const hiredThisYear = String(employee.hire_date).slice(0, 4) === String(year);
    let unjustifiedAbsenceDays = 0;
    if (hiredThisYear) {
      const absences = await db.Attendance.findAll({
        where: {
          employee_id: employee.id,
          status: "absent",
          date: { [Op.between]: [`${year}-01-01`, `${year}-12-31`] },
        },
        attributes: ["hours"],
      });
      // `hours` null = día completo; un valor parcial (mensualizados) cuenta como fracción de jornada.
      unjustifiedAbsenceDays = absences.reduce((sum, a) => sum + (a.hours == null ? 1 : Number(a.hours) / 8), 0);
    }
    entitlement = calculateVacationEntitlement({ hireDate: employee.hire_date, year, workWeek, unjustifiedAbsenceDays });
  }

  const usedDays = Number(await db.LeaveRequest.sum("total_days", {
    where: {
      employee_id: employee.id,
      leave_type: "vacation",
      status: "approved",
      start_date: { [Op.gte]: `${year}-01-01`, [Op.lte]: `${year}-12-31` },
    },
  }) || 0);

  return {
    corresponding_days: entitlement.days,
    used_days: usedDays,
    balance: entitlement.days - usedDays,
    entitlement: {
      is_override: hasOverride,
      is_proportional: entitlement.is_proportional,
      full_days: entitlement.full_days,
      worked_days: entitlement.worked_days,
      year_workdays: entitlement.year_workdays,
      required_days: entitlement.required_days,
    },
  };
}

module.exports = { getVacationBalance };
