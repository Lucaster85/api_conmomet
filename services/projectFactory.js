const { Op } = require("sequelize");
const db = require("../models");
const { lineHours } = require("../helpers/laborUnits");

/**
 * Auto-generates a root project code like P-2026-001
 */
async function generateProjectCode() {
  const year = new Date().getFullYear();
  const prefix = `P-${year}-`;

  const lastProject = await db.Project.findOne({
    where: { code: { [Op.like]: `${prefix}%` }, parent_id: null },
    order: [["code", "DESC"]],
    paranoid: false,
  });

  let seq = 1;
  if (lastProject && lastProject.code) {
    const lastSeq = parseInt(lastProject.code.replace(prefix, ""), 10);
    if (!isNaN(lastSeq)) seq = lastSeq + 1;
  }

  return `${prefix}${String(seq).padStart(3, "0")}`;
}

/**
 * Código de un adicional del módulo Adicionales: A-AAAA-NNN. Secuencia propia por año, separada de
 * "P-". El código es fijo: no cambia aunque después se asigne, cambie o quite el proyecto padre
 * (esa relación se muestra aparte, "A-2026-001 ↳ P-2026-063"). Mismo algoritmo que
 * generateProjectCode (máximo del año, incluyendo los borrados).
 */
async function generateAdditionalCode(transaction) {
  const year = new Date().getFullYear();
  const prefix = `A-${year}-`;

  const lastAdditional = await db.Project.findOne({
    where: { code: { [Op.like]: `${prefix}%` } },
    order: [["code", "DESC"]],
    paranoid: false,
    transaction,
  });

  let seq = 1;
  if (lastAdditional && lastAdditional.code) {
    const lastSeq = parseInt(lastAdditional.code.replace(prefix, ""), 10);
    if (!isNaN(lastSeq)) seq = lastSeq + 1;
  }

  return `${prefix}${String(seq).padStart(3, "0")}`;
}

/**
 * Auto-generates a subproject code from the parent's code, e.g. P-2026-005 -> P-2026-005.1
 * Looks at the max existing suffix among ALL children (including soft-deleted) to avoid collisions.
 */
async function generateSubprojectCode(parentProject, transaction) {
  const siblings = await db.Project.findAll({
    where: { parent_id: parentProject.id },
    attributes: ["code"],
    paranoid: false,
    transaction,
  });

  const prefix = `${parentProject.code}.`;
  let maxSuffix = 0;
  for (const sibling of siblings) {
    if (sibling.code && sibling.code.startsWith(prefix)) {
      const suffix = parseInt(sibling.code.slice(prefix.length), 10);
      if (!isNaN(suffix) && suffix > maxSuffix) maxSuffix = suffix;
    }
  }

  return `${prefix}${maxSuffix + 1}`;
}

/**
 * Suma las HORAS de BudgetLaborLine agrupadas por budget_item_type_id (rubro), solo líneas cuyo
 * rubro es de unit_type "hours" o "days" — devuelve un array [{ budget_item_type_id, quantity }, ...]
 * listo para volcar a ProjectHourBudgets. Un rubro puede repetirse en el presupuesto (cada línea
 * con su precio): acá se agrupan en una sola bolsa. En un rubro por días, cada línea aporta
 * quantity × hours_per_day (ver helpers/laborUnits.js); una línea vieja de un rubro que pasó de
 * horas a días tiene hours_per_day null y se sigue contando como horas.
 */
async function buildRubroHoursBreakdown(budgetId, transaction) {
  const lines = await db.BudgetLaborLine.findAll({
    where: { budget_id: budgetId },
    include: [{ model: db.BudgetItemType, as: "itemType", where: { unit_type: { [Op.in]: ["hours", "days"] } }, attributes: ["id", "unit_type"] }],
    transaction,
  });

  const byType = new Map();
  for (const line of lines) {
    const typeId = line.budget_item_type_id;
    byType.set(typeId, (byType.get(typeId) || 0) + lineHours(line));
  }

  return Array.from(byType.entries()).map(([budget_item_type_id, quantity]) => ({ budget_item_type_id, quantity }));
}

/**
 * Reemplaza las filas ProjectHourBudget de un proyecto por el desglose que trae `breakdown` —
 * mismo criterio de "pisar" que ya usaba budgeted_hours en proyectos preexistentes.
 */
async function replaceProjectHourBudgets(projectId, breakdown, transaction) {
  await db.ProjectHourBudget.destroy({ where: { project_id: projectId }, transaction });
  if (breakdown.length === 0) return;
  await db.ProjectHourBudget.bulkCreate(
    breakdown.map((b) => ({ project_id: projectId, budget_item_type_id: b.budget_item_type_id, budgeted_hours: b.quantity })),
    { transaction }
  );
}

/**
 * Crea el Project (raíz o subproyecto) correspondiente a un Budget aprobado.
 * Es el ÚNICO punto de entrada para crear subproyectos — projectController.create
 * no acepta parent_id (ver models/project.js).
 *
 * @param {import('sequelize').Model} budget - Budget en estado "approved"
 * @param {import('sequelize').Transaction} transaction
 * @returns {Promise<import('sequelize').Model>} el Project creado
 */
async function createProjectFromBudget(budget, transaction) {
  const rubroBreakdown = await buildRubroHoursBreakdown(budget.id, transaction);

  if (budget.existing_project_id) {
    const existingProject = await db.Project.findByPk(budget.existing_project_id, { transaction });
    if (!existingProject) {
      throw new Error("El proyecto indicado para vincular no existe.");
    }
    if (existingProject.parent_id) {
      throw new Error("Solo se puede vincular presupuestos a proyectos raíz.");
    }
    // No crea nada — reusa el proyecto tal cual, solo pisa sus bolsas de horas por rubro con lo
    // que trae este presupuesto (decisión de producto: hoy no se usa ese dato en proyectos
    // preexistentes, así que pisarlo es seguro). Las fechas solo se pisan si el presupuesto
    // las trae — a diferencia de las horas, no tiene sentido "resetear a null" las fechas de
    // un proyecto ya en curso solo porque el presupuesto vinculado no las cargó.
    await replaceProjectHourBudgets(existingProject.id, rubroBreakdown, transaction);
    const existingUpdates = {};
    if (budget.start_date) existingUpdates.start_date = budget.start_date;
    if (budget.end_date) existingUpdates.end_date = budget.end_date;
    if (Object.keys(existingUpdates).length > 0) await existingProject.update(existingUpdates, { transaction });
    return existingProject;
  }

  if (!budget.parent_project_id) {
    const code = await generateProjectCode();
    const project = await db.Project.create(
      {
        name: budget.title,
        code,
        client_id: budget.client_id,
        plant_id: budget.plant_id || null,
        parent_id: null,
        start_date: budget.start_date || null,
        end_date: budget.end_date || null,
        status: "active",
      },
      { transaction }
    );
    await replaceProjectHourBudgets(project.id, rubroBreakdown, transaction);
    return project;
  }

  const parentProject = await db.Project.findByPk(budget.parent_project_id, { transaction });
  if (!parentProject) {
    throw new Error("El proyecto padre indicado en el presupuesto no existe.");
  }
  if (parentProject.parent_id) {
    throw new Error("El proyecto padre ya es un subproyecto — no se admiten más de 2 niveles de jerarquía.");
  }

  const code = await generateSubprojectCode(parentProject, transaction);

  const project = await db.Project.create(
    {
      name: budget.title,
      code,
      client_id: parentProject.client_id,
      plant_id: parentProject.plant_id || null,
      parent_id: parentProject.id,
      // Un hijo de un presupuesto "adicional de" (flujo viejo) también es un adicional: igual que el
      // backfill de la migración, así aparece en el módulo Adicionales.
      is_additional: true,
      start_date: budget.start_date || null,
      end_date: budget.end_date || null,
      status: "active",
    },
    { transaction }
  );
  await replaceProjectHourBudgets(project.id, rubroBreakdown, transaction);
  return project;
}

module.exports = {
  generateProjectCode,
  generateSubprojectCode,
  generateAdditionalCode,
  createProjectFromBudget,
  buildRubroHoursBreakdown,
  replaceProjectHourBudgets,
};
