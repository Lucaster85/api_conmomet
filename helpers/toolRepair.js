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

/**
 * Avisa al responsable de la reparación (ver FLOWS.md flujo 38). Es un aviso de ACCIÓN: lo
 * dispara alguien mandando la herramienta a reparación, así que se notifica desde el controller
 * que atiende ese click — no hace falta el barrido oportunista que usan los vencimientos.
 *
 * Vive acá y no en cada controller porque los dos caminos que mandan una herramienta a
 * reparación (toolController#changeStatus manual y assetAssignmentController#returnAssignment
 * automático) tienen que avisar igual, mismo criterio que validateRepairResponsible.
 *
 * NUNCA LANZA: va después del cambio de estado, que ya está guardado.
 */
async function notifyRepairResponsible(employeeId, tool, actorUserId) {
  try {
    if (!employeeId || !tool) return;
    const employee = await db.Employee.findByPk(employeeId, { attributes: ["id", "user_id"] });
    // validateRepairResponsible ya exige user_id, así que esto no debería pasar — pero si el
    // vínculo se rompió entre la validación y acá, mejor no avisar que explotar.
    if (!employee || !employee.user_id) return;

    const { notify } = require("./notificationService");
    await notify([employee.user_id], {
      type: "tool_in_repair_assigned",
      title: "Herramienta en reparación asignada",
      body: `${tool.name}${tool.reference_code ? ` (${tool.reference_code})` : ""} quedó a tu cargo para reparación`,
      url: `/dashboard/tools/${tool.id}`,
      tag: `tool-${tool.id}`,
      entity: { type: "tool", id: tool.id },
      excludeUserId: actorUserId,
    });
  } catch (error) {
    console.error(`[tool-repair] no se pudo avisar al responsable de la herramienta ${tool && tool.id}:`, error.message);
  }
}

module.exports = { validateRepairResponsible, notifyRepairResponsible };
