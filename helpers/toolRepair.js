const db = require("../models");

// Valida el responsable elegido para una herramienta que pasa a "in_repair" — usado tanto en
// toolController.js#changeStatus (manual) como en assetAssignmentController.js#returnAssignment
// (automático al devolver), para no duplicar la regla en dos lugares.
// Debe tener un User vinculado: es la única forma que tiene hoy el sistema de avisarle (widget
// en dashboard/portal) — sin cuenta, nunca podría enterarse.
async function validateRepairResponsible(employeeId) {
  if (!employeeId) return "Debés asignar un responsable de la reparación.";
  const employee = await db.Employee.findByPk(employeeId);
  if (!employee) return "Responsable inválido.";
  if (!employee.user_id) return "El responsable debe tener un usuario del sistema vinculado para poder ver el aviso.";
  return null;
}

module.exports = { validateRepairResponsible };
