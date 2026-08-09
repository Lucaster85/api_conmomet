const { Op } = require("sequelize");
const db = require("../models");

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
 * Crea el Project (raíz o subproyecto) correspondiente a un Budget aprobado.
 * Es el ÚNICO punto de entrada para crear subproyectos — projectController.create
 * no acepta parent_id (ver models/project.js).
 *
 * @param {import('sequelize').Model} budget - Budget en estado "approved"
 * @param {import('sequelize').Transaction} transaction
 * @returns {Promise<import('sequelize').Model>} el Project creado
 */
async function createProjectFromBudget(budget, transaction) {
  const budgetedHours = await db.BudgetLaborLine.sum("quantity", {
    where: { budget_id: budget.id },
    include: [{ model: db.BudgetItemType, as: "itemType", where: { unit_type: "hours" }, attributes: [] }],
    transaction,
  });

  if (budget.existing_project_id) {
    const existingProject = await db.Project.findByPk(budget.existing_project_id, { transaction });
    if (!existingProject) {
      throw new Error("El proyecto indicado para vincular no existe.");
    }
    if (existingProject.parent_id) {
      throw new Error("Solo se puede vincular presupuestos a proyectos raíz.");
    }
    // No crea nada — reusa el proyecto tal cual, solo sobreescribe budgeted_hours con lo
    // que trae este presupuesto (decisión de producto: hoy no se usa ese campo en proyectos
    // preexistentes, así que pisarlo es seguro). Las fechas solo se pisan si el presupuesto
    // las trae — a diferencia de las horas, no tiene sentido "resetear a null" las fechas de
    // un proyecto ya en curso solo porque el presupuesto vinculado no las cargó.
    const existingUpdates = { budgeted_hours: budgetedHours || 0 };
    if (budget.start_date) existingUpdates.start_date = budget.start_date;
    if (budget.end_date) existingUpdates.end_date = budget.end_date;
    await existingProject.update(existingUpdates, { transaction });
    return existingProject;
  }

  if (!budget.parent_project_id) {
    const code = await generateProjectCode();
    return db.Project.create(
      {
        name: budget.title,
        code,
        client_id: budget.client_id,
        plant_id: budget.plant_id || null,
        parent_id: null,
        budgeted_hours: budgetedHours || 0,
        start_date: budget.start_date || null,
        end_date: budget.end_date || null,
        status: "active",
      },
      { transaction }
    );
  }

  const parentProject = await db.Project.findByPk(budget.parent_project_id, { transaction });
  if (!parentProject) {
    throw new Error("El proyecto padre indicado en el presupuesto no existe.");
  }
  if (parentProject.parent_id) {
    throw new Error("El proyecto padre ya es un subproyecto — no se admiten más de 2 niveles de jerarquía.");
  }

  const code = await generateSubprojectCode(parentProject, transaction);

  return db.Project.create(
    {
      name: budget.title,
      code,
      client_id: parentProject.client_id,
      plant_id: parentProject.plant_id || null,
      parent_id: parentProject.id,
      budgeted_hours: budgetedHours || 0,
      start_date: budget.start_date || null,
      end_date: budget.end_date || null,
      status: "active",
    },
    { transaction }
  );
}

module.exports = {
  generateProjectCode,
  generateSubprojectCode,
  createProjectFromBudget,
};
