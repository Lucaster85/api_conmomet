const { Op } = require("sequelize");
const db = require("../models");
const { userHasPermission } = require("../helpers");
const { sumConsumedHoursByType } = require("./projectController");
const { generateAdditionalCode, buildRubroHoursBreakdown, replaceProjectHourBudgets } = require("../services/projectFactory");
const { generateBudgetNumber, duplicateBudget } = require("../services/budgetFactory");
const { saveMaterialItems } = require("../services/budgetMaterialService");
const { pickCurrentBudget, getCurrentAdditionalBudget, hasLiveBudget, syncAdditionalBudget } = require("../services/additionalBudgetService");

/**
 * Módulo Adicionales (/additionals): un adicional es un proyecto urgente (Project.is_additional)
 * que arranca YA —activo, listo para cargar horas— junto con su presupuesto en borrador, con o sin
 * proyecto padre. Desde acá se cargan los materiales (que viven en el presupuesto) y la
 * descripción. El margen y el precio al cliente NUNCA se devuelven ni se editan desde este módulo.
 * Ver FLOWS.md flujo 30.
 *
 * Todo lo que necesite "el presupuesto" del adicional lo resuelve con additionalBudgetService
 * (vigente = último no rechazado), nunca con project.budget.
 */

const PROJECT_STATUSES = ["draft", "active", "paused", "completed", "cancelled"];

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Fecha de hoy en hora argentina (la base trabaja en -03:00), para el default de start_date.
const todayStr = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);

const projectInclude = [
  { model: db.Client, as: "client", attributes: ["id", "razonSocial"] },
  { model: db.Plant, as: "plant", attributes: ["id", "name"] },
  { model: db.Project, as: "parent", attributes: ["id", "code", "name"] },
  {
    model: db.Budget, as: "budgets",
    attributes: ["id", "number", "status", "currency", "createdAt", "sent_at", "rejected_at", "rejection_reason"],
  },
];

const budgetSummary = (budget) => (budget ? {
  id: budget.id,
  number: budget.number,
  status: budget.status,
  currency: budget.currency,
  rejection_reason: budget.rejection_reason || null,
  rejected_at: budget.rejected_at || null,
  sent_at: budget.sent_at || null,
} : null);

/**
 * Padre de un adicional: proyecto existente, no adicional, raíz, distinto de sí mismo y del mismo
 * cliente. Las horas ya cargadas pasan a consolidarse en el nuevo padre sin tocar nada más
 * (sumConsumedHours y el parte diario resuelven los hijos por parent_id).
 */
async function validateAdditionalParent(parentId, { additional, clientId }, transaction) {
  const parent = await db.Project.findByPk(parentId, { transaction });
  if (!parent) throw httpError(400, "El proyecto padre indicado no existe.");
  if (parent.is_additional) throw httpError(400, "Un adicional no puede ser el proyecto padre de otro adicional.");
  if (parent.parent_id) throw httpError(400, "El proyecto padre tiene que ser un proyecto raíz.");
  if (additional && parent.id === additional.id) throw httpError(400, "Un adicional no puede ser su propio padre.");
  const expectedClient = additional ? additional.client_id : clientId;
  if (expectedClient && parent.client_id !== Number(expectedClient)) {
    throw httpError(400, "El proyecto padre tiene que ser del mismo cliente que el adicional.");
  }
  return parent;
}

// Líneas de material del presupuesto, SIN margen ni precio al cliente. Sin material_costs_read
// tampoco se devuelve el costo.
async function loadMaterialItems(budgetId, user) {
  const canSeeCosts = userHasPermission(user, "material_costs_read");
  const items = await db.BudgetMaterialItem.findAll({
    where: { budget_id: budgetId },
    include: [
      { model: db.MaterialUnit, as: "materialUnit" },
      { model: db.Material, as: "material", attributes: ["id", "description"] },
      { model: db.Provider, as: "provider", paranoid: false, attributes: ["id", "razonSocial", "is_system"] },
    ],
    order: [["id", "ASC"]],
  });
  return items.map((item) => {
    const row = {
      id: item.id,
      material_id: item.material_id,
      provider_id: item.provider_id,
      provider: item.provider,
      description: item.description,
      quantity: item.quantity,
      material_unit_id: item.material_unit_id,
      materialUnit: item.materialUnit,
      material: item.material,
    };
    if (canSeeCosts) {
      row.material_cost_snapshot = item.material_cost_snapshot;
      row.material_cost_currency = item.material_cost_currency;
    }
    return row;
  });
}

const sumHours = (typeMap) => (typeMap ? Array.from(typeMap.values()).reduce((sum, h) => sum + h, 0) : 0);

async function loadDetail(id, user, transaction) {
  const project = await db.Project.findOne({ where: { id, is_additional: true }, include: projectInclude, transaction });
  if (!project) return null;

  const data = project.toJSON();
  const budgets = data.budgets || [];
  delete data.budgets;

  const current = pickCurrentBudget(budgets);
  data.current_budget = budgetSummary(current);
  data.current_budget_items = current ? await loadMaterialItems(current.id, user) : [];
  // El resto de los presupuestos del adicional (rechazados), del más nuevo al más viejo: queda
  // registro de qué versión rechazó el cliente y por qué.
  data.budget_history = budgets
    .filter((b) => !current || b.id !== current.id)
    .sort((a, b) => new Date(b.createdAt || b.created_at) - new Date(a.createdAt || a.created_at) || b.id - a.id)
    .map((b) => ({ ...budgetSummary(b), created_at: b.createdAt || b.created_at }));

  const hoursMap = await sumConsumedHoursByType([project.id]);
  data.consumed_hours_own = sumHours(hoursMap.get(project.id));
  return data;
}

async function respondWithDetail(res, status, id, user) {
  const data = await loadDetail(id, user);
  return res.status(status).json({ data });
}

module.exports = {
  getAll: async (req, res) => {
    try {
      const { client_id, status, has_parent, q } = req.query;
      const where = { is_additional: true };
      if (client_id) where.client_id = client_id;
      if (status) where.status = status;
      if (has_parent === "true") where.parent_id = { [Op.ne]: null };
      if (has_parent === "false") where.parent_id = null;
      if (q) where[Op.or] = [{ name: { [Op.like]: `%${q}%` } }, { code: { [Op.like]: `%${q}%` } }];

      const projects = await db.Project.findAll({ where, include: projectInclude, order: [["created_at", "DESC"]] });
      // Una sola query de horas para todo el listado (sin N+1).
      const hoursMap = await sumConsumedHoursByType(projects.map((p) => p.id));

      const data = projects.map((project) => {
        const row = project.toJSON();
        const budgets = row.budgets || [];
        delete row.budgets;
        row.current_budget = budgetSummary(pickCurrentBudget(budgets));
        row.consumed_hours_own = sumHours(hoursMap.get(project.id));
        return row;
      });
      return res.status(200).json({ data });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  get: async (req, res) => {
    try {
      const data = await loadDetail(req.params.id, req.user);
      if (!data) return res.status(404).json({ error: "Adicional no encontrado." });
      return res.status(200).json({ data });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // Listas MÍNIMAS de clientes y plantas para el alta/edición, para que alcance con additionals_*
  // sin clients_read/plants_read — solo id y nombre, no los datos completos del cliente.
  catalogClients: async (req, res) => {
    try {
      const clients = await db.Client.findAll({ where: { is_active: true }, attributes: ["id", "razonSocial"], order: [["razonSocial", "ASC"]] });
      return res.status(200).json({ data: clients });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  catalogPlants: async (req, res) => {
    try {
      const plants = await db.Plant.findAll({ attributes: ["id", "name", "client_id"], order: [["name", "ASC"]] });
      return res.status(200).json({ data: plants });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // Proyectos que pueden ser padre de un adicional del cliente: raíces que no son adicionales.
  parentOptions: async (req, res) => {
    try {
      const { client_id } = req.query;
      if (!client_id) return res.status(200).json({ data: [] });
      const projects = await db.Project.findAll({
        where: { client_id, is_additional: false, parent_id: null },
        attributes: ["id", "code", "name", "client_id", "plant_id"],
        include: [{ model: db.Plant, as: "plant", attributes: ["id", "name"] }],
        order: [["code", "DESC"]],
      });
      return res.status(200).json({ data: projects });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // Crea, en una sola transacción, el proyecto (activo, listo para cargar horas) y su presupuesto
  // en borrador (sin líneas).
  create: async (req, res) => {
    const { name, client_id, plant_id, parent_id, description, start_date, currency } = req.body;
    const trimmedName = (name || "").toString().trim();
    if (!trimmedName) return res.status(400).json({ error: "El nombre es obligatorio." });
    if (trimmedName.length > 150) return res.status(400).json({ error: "El nombre no puede superar los 150 caracteres." });
    if (!parent_id && !client_id) return res.status(400).json({ error: "El cliente es obligatorio." });
    if (currency && !["ARS", "USD"].includes(currency)) return res.status(400).json({ error: "La moneda debe ser ARS o USD." });

    const transaction = await db.sequelize.transaction();
    try {
      let clientId = client_id;
      let plantId = plant_id || null;
      let parent = null;

      if (parent_id) {
        parent = await validateAdditionalParent(parent_id, {}, transaction);
        // Cliente y planta se fuerzan desde el padre (nunca de lo que mande el body), igual que
        // resolveProjectLinkage en presupuestos.
        clientId = parent.client_id;
        plantId = parent.plant_id || null;
      } else {
        const client = await db.Client.findByPk(client_id, { transaction });
        if (!client) throw httpError(400, "Cliente no encontrado.");
        if (plantId) {
          const plant = await db.Plant.findByPk(plantId, { transaction });
          if (!plant) throw httpError(400, "Planta no encontrada.");
          if (plant.client_id && plant.client_id !== Number(clientId)) throw httpError(400, "La planta no pertenece al cliente seleccionado.");
        }
      }

      const startDate = start_date || todayStr();
      const project = await db.Project.create({
        name: trimmedName,
        code: await generateAdditionalCode(transaction),
        client_id: clientId,
        plant_id: plantId,
        parent_id: parent ? parent.id : null,
        is_additional: true,
        description: description || null,
        status: "active",
        start_date: startDate,
      }, { transaction });

      await db.Budget.create({
        number: await generateBudgetNumber(transaction),
        title: trimmedName,
        description: description || null,
        client_id: clientId,
        plant_id: plantId,
        currency: currency || "ARS",
        project_id: project.id,
        start_date: startDate,
        validity_days: 15,
        status: "draft",
        created_by: req.user.id,
      }, { transaction });

      await transaction.commit();
      return respondWithDetail(res, 201, project.id, req.user);
    } catch (error) {
      await transaction.rollback();
      return res.status(error.status || 500).json({ error: error.message });
    }
  },

  update: async (req, res) => {
    const transaction = await db.sequelize.transaction();
    try {
      const project = await db.Project.findOne({ where: { id: req.params.id, is_additional: true }, transaction });
      if (!project) {
        await transaction.rollback();
        return res.status(404).json({ error: "Adicional no encontrado." });
      }

      const { name, description, plant_id, parent_id, status, start_date, end_date } = req.body;
      const changes = {};

      if (name !== undefined) {
        const trimmed = (name || "").toString().trim();
        if (!trimmed) throw httpError(400, "El nombre es obligatorio.");
        if (trimmed.length > 150) throw httpError(400, "El nombre no puede superar los 150 caracteres.");
        changes.name = trimmed;
      }
      if (description !== undefined) changes.description = description || null;
      if (status !== undefined) {
        if (!PROJECT_STATUSES.includes(status)) throw httpError(400, "Estado inválido.");
        changes.status = status;
      }
      if (start_date !== undefined) changes.start_date = start_date || null;
      if (end_date !== undefined) changes.end_date = end_date || null;

      if (plant_id !== undefined) {
        if (plant_id) {
          const plant = await db.Plant.findByPk(plant_id, { transaction });
          if (!plant) throw httpError(400, "Planta no encontrada.");
          if (plant.client_id && plant.client_id !== project.client_id) throw httpError(400, "La planta no pertenece al cliente del adicional.");
        }
        changes.plant_id = plant_id || null;
      }

      // Padre: se puede asignar, cambiar o quitar (null) en cualquier momento. El código del
      // adicional NO cambia. Al asignar un padre con planta, la planta pasa a ser la del padre.
      if (parent_id !== undefined) {
        if (parent_id) {
          const parent = await validateAdditionalParent(parent_id, { additional: project }, transaction);
          changes.parent_id = parent.id;
          if (parent.plant_id) changes.plant_id = parent.plant_id;
        } else {
          changes.parent_id = null;
        }
      }

      await project.update(changes, { transaction });
      // Mientras el presupuesto esté en borrador, nombre/descripción/planta se copian a él.
      await syncAdditionalBudget(project, transaction);

      await transaction.commit();
      return respondWithDetail(res, 200, project.id, req.user);
    } catch (error) {
      await transaction.rollback();
      return res.status(error.status || 500).json({ error: error.message });
    }
  },

  // Materiales del presupuesto VIGENTE, solo mientras esté en borrador. No se ve ni se toca el
  // margen: las líneas existentes lo conservan (el que haya cargado después el área comercial
  // desde Presupuestos) y las nuevas nacen con margen 0.
  updateMaterials: async (req, res) => {
    const { items } = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: "Se esperaba una lista de materiales." });

    const transaction = await db.sequelize.transaction();
    try {
      const project = await db.Project.findOne({ where: { id: req.params.id, is_additional: true }, transaction });
      if (!project) {
        await transaction.rollback();
        return res.status(404).json({ error: "Adicional no encontrado." });
      }

      const budget = await getCurrentAdditionalBudget(project.id, transaction);
      if (!budget) throw httpError(404, "El adicional no tiene presupuesto.");
      if (budget.status !== "draft") {
        throw httpError(409, "El presupuesto del adicional ya fue enviado: los materiales quedan en solo lectura.");
      }

      // Cada línea tiene que estar vinculada al catálogo (sin costo real no hay presupuesto).
      const materialIds = [...new Set(items.map((i) => i && i.material_id).filter(Boolean))];
      const materials = await db.Material.findAll({ where: { id: materialIds }, transaction });
      const materialById = new Map(materials.map((m) => [m.id, m]));
      const prepared = items.map((item, idx) => {
        const material = item && materialById.get(Number(item.material_id));
        if (!material) throw httpError(400, `La línea ${idx + 1} no tiene un material del catálogo.`);
        return {
          ...item,
          material_id: material.id,
          description: item.description || material.description,
          material_unit_id: item.material_unit_id || material.material_unit_id,
          // Aunque llegue, el margen no se usa (preserveMargins).
          margin_percent: undefined,
        };
      });

      await saveMaterialItems(budget, prepared, req.user, transaction, { preserveMargins: true });

      await transaction.commit();
      return res.status(200).json({ data: await loadMaterialItems(budget.id, req.user) });
    } catch (error) {
      await transaction.rollback();
      return res.status(error.status || 500).json({ error: error.message });
    }
  },

  // "Nuevo presupuesto": duplica el presupuesto RECHAZADO como borrador nuevo vinculado al mismo
  // adicional, con sus materiales y mano de obra como punto de partida. Un solo presupuesto vivo
  // a la vez. (Reabrir el rechazado a borrador se descartó: perdería la versión rechazada.)
  newBudget: async (req, res) => {
    const transaction = await db.sequelize.transaction();
    try {
      const project = await db.Project.findOne({ where: { id: req.params.id, is_additional: true }, transaction });
      if (!project) {
        await transaction.rollback();
        return res.status(404).json({ error: "Adicional no encontrado." });
      }

      if (await hasLiveBudget(project.id, transaction)) throw httpError(400, "El adicional ya tiene un presupuesto en curso.");
      const current = await getCurrentAdditionalBudget(project.id, transaction, {
        include: [
          { model: db.BudgetLaborLine, as: "laborLines" },
          { model: db.BudgetMaterialItem, as: "materialItems" },
        ],
      });
      if (!current || current.status !== "rejected") throw httpError(400, "Solo se puede crear un presupuesto nuevo a partir de uno rechazado.");

      // Título y descripción vienen del proyecto (la fuente actual), no del rechazado.
      const copy = await duplicateBudget(current, {
        title: project.name,
        description: project.description,
        project_id: project.id,
      }, req.user, transaction);
      await copy.update({ plant_id: project.plant_id || null }, { transaction });

      // Si el nuevo presupuesto trae mano de obra, se resincronizan las bolsas de horas del
      // proyecto, igual que en budgets create/update.
      if (current.laborLines.length > 0) {
        const rubroBreakdown = await buildRubroHoursBreakdown(copy.id, transaction);
        await replaceProjectHourBudgets(project.id, rubroBreakdown, transaction);
      }

      await transaction.commit();
      return respondWithDetail(res, 201, project.id, req.user);
    } catch (error) {
      await transaction.rollback();
      return res.status(error.status || 500).json({ error: error.message });
    }
  },

  // Misma regla que projectController.destroy (bloquea si hay horas cargadas) y, además, bloquea
  // si algún presupuesto ya salió de borrador. Si pasa, se eliminan el proyecto y su presupuesto.
  destroy: async (req, res) => {
    const transaction = await db.sequelize.transaction();
    try {
      const project = await db.Project.findOne({ where: { id: req.params.id, is_additional: true }, transaction });
      if (!project) {
        await transaction.rollback();
        return res.status(404).json({ error: "Adicional no encontrado." });
      }

      const entryCount = await db.TimeEntry.count({
        where: { project_id: project.id, status: { [Op.in]: ["pending", "approved"] } },
        transaction,
      });
      if (entryCount > 0) {
        throw httpError(400, `No se puede eliminar un adicional con ${entryCount} registro(s) de horas. Cambie su estado a "cancelado" en su lugar.`);
      }

      const budgets = await db.Budget.findAll({ where: { project_id: project.id }, attributes: ["id", "status"], transaction });
      if (budgets.some((b) => b.status !== "draft")) {
        throw httpError(400, "No se puede eliminar: el presupuesto del adicional ya fue enviado. Cambie el estado del adicional a \"cancelado\" en su lugar.");
      }

      await db.Budget.destroy({ where: { id: budgets.map((b) => b.id) }, transaction });
      await project.destroy({ transaction });

      await transaction.commit();
      return res.status(200).json({ message: "Adicional eliminado." });
    } catch (error) {
      await transaction.rollback();
      return res.status(error.status || 500).json({ error: error.message });
    }
  },
};
