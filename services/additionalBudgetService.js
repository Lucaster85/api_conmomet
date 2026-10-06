const { Op } = require("sequelize");
const db = require("../models");

/**
 * Presupuesto "vigente" de un ADICIONAL. Un adicional puede tener varios presupuestos con el mismo
 * project_id (los rechazados quedan de historial), pero solo UNO vivo (no rechazado) a la vez. Por
 * eso Project.hasOne("budget") no sirve para adicionales (devuelve uno arbitrario): todo el código
 * del módulo Adicionales, y la pestaña Presupuesto del proyecto, resuelven el presupuesto por acá.
 *
 * Vigente = el último no rechazado o, si todos están rechazados, el último rechazado.
 */

const newestFirst = (a, b) => {
  const byDate = new Date(b.created_at || b.createdAt) - new Date(a.created_at || a.createdAt);
  return byDate !== 0 ? byDate : b.id - a.id;
};

// Versión en memoria, para resolver el vigente de muchos adicionales con una sola query.
function pickCurrentBudget(budgets) {
  const sorted = [...(budgets || [])].sort(newestFirst);
  return sorted.find((b) => b.status !== "rejected") || sorted[0] || null;
}

async function getCurrentAdditionalBudget(projectId, transaction, options = {}) {
  const base = { order: [["created_at", "DESC"], ["id", "DESC"]], transaction, ...options };
  const live = await db.Budget.findOne({ ...base, where: { project_id: projectId, status: { [Op.ne]: "rejected" } } });
  if (live) return live;
  return db.Budget.findOne({ ...base, where: { project_id: projectId } });
}

async function hasLiveBudget(projectId, transaction) {
  const count = await db.Budget.count({ where: { project_id: projectId, status: { [Op.ne]: "rejected" } }, transaction });
  return count > 0;
}

/**
 * Mientras el presupuesto vigente esté en borrador, nombre/descripción/planta del adicional se
 * copian a él (título ← nombre). Una vez enviado queda congelado: es lo que se le mandó al
 * cliente, y el proyecto puede seguir editándose.
 */
async function syncAdditionalBudget(project, transaction) {
  const budget = await getCurrentAdditionalBudget(project.id, transaction);
  if (!budget || budget.status !== "draft") return null;
  await budget.update({
    title: project.name,
    description: project.description || null,
    plant_id: project.plant_id || null,
  }, { transaction });
  return budget;
}

module.exports = { pickCurrentBudget, getCurrentAdditionalBudget, hasLiveBudget, syncAdditionalBudget };
