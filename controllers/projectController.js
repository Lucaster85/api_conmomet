const { Op, fn, col, literal } = require("sequelize");
const db = require("../models");
const { generateProjectCode } = require("../services/projectFactory");
const { userHasPermission, computeTotalsByCurrency } = require("../helpers");
const { applyPriceVisibility } = require("../helpers/budgetTotals");

// Horas consumidas por proyecto Y por rubro (budget_item_type_id null = "Generales") —
// devuelve Map<project_id, Map<budget_item_type_id|null, horas>>.
async function sumConsumedHoursByType(projectIds) {
  if (projectIds.length === 0) return new Map();
  const rows = await db.TimeEntry.findAll({
    where: { project_id: { [Op.in]: projectIds }, status: "approved" },
    attributes: [
      "project_id",
      "budget_item_type_id",
      [fn("SUM", col("regular_hours")), "total_regular"],
      [fn("SUM", col("overtime_50_hours")), "total_50"],
      [fn("SUM", col("overtime_100_hours")), "total_100"],
    ],
    group: ["project_id", "budget_item_type_id"],
  });

  const map = new Map();
  for (const row of rows) {
    const reg = parseFloat(row.getDataValue("total_regular") || 0);
    const ot50 = parseFloat(row.getDataValue("total_50") || 0);
    const ot100 = parseFloat(row.getDataValue("total_100") || 0);
    const hours = reg + ot50 * 0.5 + ot100 * 1.0;
    if (!map.has(row.project_id)) map.set(row.project_id, new Map());
    map.get(row.project_id).set(row.budget_item_type_id, hours);
  }
  return map;
}

// Arma, para cada proyecto, la lista de bolsas de horas por rubro (incluida "Generales") con
// presupuestado + consumido, más los totales — reemplaza al único Project.budgeted_hours.
async function buildHourBuckets(projectIds) {
  if (projectIds.length === 0) return new Map();

  const [budgetRows, consumedByType] = await Promise.all([
    db.ProjectHourBudget.findAll({
      where: { project_id: { [Op.in]: projectIds } },
    }),
    sumConsumedHoursByType(projectIds),
  ]);

  const typeIds = new Set();
  budgetRows.forEach((r) => { if (r.budget_item_type_id) typeIds.add(r.budget_item_type_id); });
  consumedByType.forEach((typeMap) => {
    typeMap.forEach((_, typeId) => { if (typeId) typeIds.add(typeId); });
  });

  const itemTypes = typeIds.size > 0
    ? await db.BudgetItemType.findAll({ where: { id: { [Op.in]: [...typeIds] } }, attributes: ["id", "name"], paranoid: false })
    : [];
  const nameById = new Map(itemTypes.map((it) => [it.id, it.name]));

  const keyFor = (typeId) => (typeId === null || typeId === undefined ? "general" : String(typeId));

  const result = new Map();
  for (const projectId of projectIds) {
    result.set(projectId, new Map());
  }

  budgetRows.forEach((row) => {
    const buckets = result.get(row.project_id);
    buckets.set(keyFor(row.budget_item_type_id), {
      budget_item_type_id: row.budget_item_type_id,
      item_type_name: row.budget_item_type_id ? (nameById.get(row.budget_item_type_id) || "—") : "Generales",
      budgeted_hours: parseFloat(row.budgeted_hours || 0),
      consumed_hours: 0,
    });
  });

  for (const [projectId, typeMap] of consumedByType) {
    const buckets = result.get(projectId);
    if (!buckets) continue;
    for (const [typeId, hours] of typeMap) {
      const key = keyFor(typeId);
      if (buckets.has(key)) {
        buckets.get(key).consumed_hours = hours;
      } else {
        buckets.set(key, {
          budget_item_type_id: typeId,
          item_type_name: typeId ? (nameById.get(typeId) || "—") : "Generales",
          budgeted_hours: 0,
          consumed_hours: hours,
        });
      }
    }
  }

  const finalResult = new Map();
  for (const [projectId, buckets] of result) {
    const list = Array.from(buckets.values()).sort((a, b) => {
      if (a.budget_item_type_id === null) return 1;
      if (b.budget_item_type_id === null) return -1;
      return a.item_type_name.localeCompare(b.item_type_name);
    });
    const budgeted_hours_total = list.reduce((sum, b) => sum + b.budgeted_hours, 0);
    const consumed_hours_total = list.reduce((sum, b) => sum + b.consumed_hours, 0);
    finalResult.set(projectId, { hour_buckets: list, budgeted_hours_total, consumed_hours_total });
  }
  return finalResult;
}

module.exports = {
  getAll: async (req, res) => {
    try {
      const { client_id, status, plant_id, include_children, without_budget } = req.query;
      const where = {};

      if (client_id) where.client_id = client_id;
      if (plant_id) where.plant_id = plant_id;
      if (status) where.status = status;
      if (include_children !== "true") where.parent_id = null;

      if (without_budget === "true") {
        // Para el selector "Vincular a un proyecto existente" en Presupuestos: solo proyectos
        // raíz que no tengan ya un presupuesto generado (project_id) ni pendiente de aprobar
        // (existing_project_id) — un rechazado no cuenta, no debe bloquear el proyecto.
        where.parent_id = null;
        const claimedBudgets = await db.Budget.findAll({
          where: { status: { [Op.ne]: "rejected" } },
          attributes: ["project_id", "existing_project_id"],
          raw: true,
        });
        const claimedIds = new Set();
        for (const b of claimedBudgets) {
          if (b.project_id) claimedIds.add(b.project_id);
          if (b.existing_project_id) claimedIds.add(b.existing_project_id);
        }
        if (claimedIds.size > 0) where.id = { [Op.notIn]: [...claimedIds] };
      }

      const projects = await db.Project.findAll({
        where,
        include: [
          { model: db.Client, as: "client", attributes: ["id", "razonSocial"] },
          { model: db.Plant, as: "plant", attributes: ["id", "name"] },
          { model: db.ClientSupervisor, as: "supervisors", attributes: ["id", "name", "lastname"], through: { attributes: [] } },
          { model: db.Project, as: "subprojects", attributes: ["id"], paranoid: true },
        ],
        order: [["created_at", "DESC"]],
      });

      // Traemos también las horas de los hijos para poder consolidar en el padre
      const allRelevantIds = new Set();
      for (const p of projects) {
        allRelevantIds.add(p.id);
        for (const sp of p.subprojects || []) allRelevantIds.add(sp.id);
      }
      const hourBucketsMap = await buildHourBuckets([...allRelevantIds]);

      // Presupuesto vinculado (solo número/id/estado, sin montos) — igual que en el detalle,
      // gateado por budgets_read. Para el flag/acceso directo en el listado de Proyectos.
      const budgetsByProjectId = new Map();
      if (userHasPermission(req.user, "budgets_read") && projects.length > 0) {
        const linkedBudgets = await db.Budget.findAll({
          where: { project_id: { [Op.in]: projects.map((p) => p.id) } },
          attributes: ["id", "number", "status", "project_id"],
          raw: true,
        });
        for (const b of linkedBudgets) {
          budgetsByProjectId.set(b.project_id, { id: b.id, number: b.number, status: b.status });
        }
      }

      const result = projects.map((p) => {
        const pData = p.toJSON();
        const own = hourBucketsMap.get(p.id) || { budgeted_hours_total: 0, consumed_hours_total: 0 };
        const childrenTotals = (p.subprojects || []).reduce((acc, sp) => {
          const spTotals = hourBucketsMap.get(sp.id) || { budgeted_hours_total: 0, consumed_hours_total: 0 };
          acc.budgeted += spTotals.budgeted_hours_total;
          acc.consumed += spTotals.consumed_hours_total;
          return acc;
        }, { budgeted: 0, consumed: 0 });

        pData.subproject_count = (p.subprojects || []).length;
        delete pData.subprojects;
        pData.budgeted_hours_own = own.budgeted_hours_total;
        pData.budgeted_hours_total = own.budgeted_hours_total + childrenTotals.budgeted;
        pData.consumed_hours_own = own.consumed_hours_total;
        pData.consumed_hours_total = own.consumed_hours_total + childrenTotals.consumed;
        pData.budget = budgetsByProjectId.get(p.id) || null;

        return pData;
      });

      return res.status(200).json({ data: result });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  get: async (req, res) => {
    try {
      const project = await db.Project.findByPk(req.params.id, {
        include: [
          { model: db.Client, as: "client", attributes: ["id", "razonSocial"] },
          { model: db.Plant, as: "plant", attributes: ["id", "name"] },
          { model: db.ClientSupervisor, as: "supervisors", through: { attributes: [] } },
          { model: db.Project, as: "parent", attributes: ["id", "name", "code"] },
          { model: db.Project, as: "subprojects", attributes: ["id", "name", "code", "status"] },
        ],
      });

      if (!project) return res.status(404).json({ error: "Proyecto no encontrado." });

      const pData = project.toJSON();

      const childIds = (project.subprojects || []).map((sp) => sp.id);
      const hourBucketsMap = await buildHourBuckets([project.id, ...childIds]);

      const own = hourBucketsMap.get(project.id) || { hour_buckets: [], budgeted_hours_total: 0, consumed_hours_total: 0 };
      const childrenTotals = childIds.reduce((acc, id) => {
        const spTotals = hourBucketsMap.get(id) || { budgeted_hours_total: 0, consumed_hours_total: 0 };
        acc.budgeted += spTotals.budgeted_hours_total;
        acc.consumed += spTotals.consumed_hours_total;
        return acc;
      }, { budgeted: 0, consumed: 0 });

      pData.hour_buckets = own.hour_buckets;
      pData.budgeted_hours_own = own.budgeted_hours_total;
      pData.budgeted_hours_total = own.budgeted_hours_total + childrenTotals.budgeted;
      pData.consumed_hours_own = own.consumed_hours_total;
      pData.consumed_hours_total = own.consumed_hours_total + childrenTotals.consumed;
      pData.subprojects = (project.subprojects || []).map((sp) => {
        const spTotals = hourBucketsMap.get(sp.id) || { hour_buckets: [], budgeted_hours_total: 0, consumed_hours_total: 0 };
        return {
          ...sp.toJSON(),
          hour_buckets: spTotals.hour_buckets,
          budgeted_hours_own: spTotals.budgeted_hours_total,
          consumed_hours_own: spTotals.consumed_hours_total,
        };
      });

      // Costo real de mano de obra: TimeEntries aprobados × tarifa vigente del empleado
      const entries = await db.TimeEntry.findAll({
        where: { project_id: { [Op.in]: [project.id, ...childIds] }, status: "approved" },
        include: [{
          model: db.Employee,
          as: "employee",
          attributes: ["id", "category_id", "hourly_rate"],
          include: [{ model: db.Category, as: "category", attributes: ["id", "guild_hourly_rate"] }],
        }],
      });

      let consumedCostLabor = 0;
      for (const entry of entries) {
        const emp = entry.employee;
        if (!emp) continue;
        const rate = (emp.category ? parseFloat(emp.category.guild_hourly_rate || 0) : 0) || parseFloat(emp.hourly_rate || 0);
        const reg = parseFloat(entry.regular_hours || 0);
        const ot50 = parseFloat(entry.overtime_50_hours || 0);
        const ot100 = parseFloat(entry.overtime_100_hours || 0);
        consumedCostLabor += rate * (reg + ot50 * 1.5 + ot100 * 2);
      }
      pData.consumed_cost_labor = consumedCostLabor;

      // Presupuesto vinculado: solo si el usuario tiene permiso budgets_read
      if (userHasPermission(req.user, "budgets_read")) {
        const budget = await db.Budget.findOne({
          where: { project_id: project.id },
          include: [
            { model: db.BudgetLaborLine, as: "laborLines", include: [{ model: db.BudgetItemType, as: "itemType" }] },
            { model: db.BudgetMaterialItem, as: "materialItems", include: [{ model: db.MaterialUnit, as: "materialUnit" }] },
          ],
        });
        if (budget) {
          const budgetData = budget.toJSON();
          budgetData.totals_by_currency = computeTotalsByCurrency(budgetData, budgetData.laborLines || [], budgetData.materialItems || []);
          // Costo real y precios: mismo criterio que budgetController.js#withTotals.
          applyPriceVisibility(budgetData, req.user);
          pData.budget = budgetData;
        } else {
          pData.budget = null;
        }
      } else {
        delete pData.hour_buckets;
        delete pData.budgeted_hours_own;
        delete pData.budgeted_hours_total;
        pData.subprojects = (pData.subprojects || []).map((sp) => {
          const { hour_buckets, budgeted_hours_own, ...rest } = sp;
          return rest;
        });
      }

      return res.status(200).json({ data: pData });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    try {
      const { name, code, client_id, plant_id, description, status, start_date, end_date, notes, parent_id } = req.body;

      if (parent_id) {
        return res.status(400).json({
          error: "No se pueden crear subproyectos manualmente. Los subproyectos/adicionales se generan aprobando un Presupuesto asociado al proyecto padre.",
        });
      }

      if (!name || !client_id) {
        return res.status(400).json({ error: "Nombre y cliente son obligatorios." });
      }

      // Validate client exists
      const client = await db.Client.findByPk(client_id);
      if (!client) return res.status(400).json({ error: "Cliente no encontrado." });

      // Validate plant belongs to client if provided
      if (plant_id) {
        const plant = await db.Plant.findByPk(plant_id);
        if (!plant) return res.status(400).json({ error: "Planta no encontrada." });
        if (plant.client_id && plant.client_id !== parseInt(client_id)) {
          return res.status(400).json({ error: "La planta no pertenece al cliente seleccionado." });
        }
      }

      const projectCode = code || await generateProjectCode();

      // Check code uniqueness
      const existing = await db.Project.findOne({ where: { code: projectCode }, paranoid: false });
      if (existing) return res.status(400).json({ error: `El código ${projectCode} ya está en uso.` });

      const project = await db.Project.create({
        name,
        code: projectCode,
        client_id,
        plant_id: plant_id || null,
        description: description || null,
        status: status || "active",
        start_date: start_date || null,
        end_date: end_date || null,
        notes: notes || null,
      });

      return res.status(201).json({ data: project });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  update: async (req, res) => {
    try {
      const project = await db.Project.findByPk(req.params.id);
      if (!project) return res.status(404).json({ error: "Proyecto no encontrado." });

      const { name, code, client_id, plant_id, description, status, start_date, end_date, notes } = req.body;

      // Validate code uniqueness if changed
      if (code && code !== project.code) {
        const existing = await db.Project.findOne({ where: { code, id: { [Op.ne]: project.id } }, paranoid: false });
        if (existing) return res.status(400).json({ error: `El código ${code} ya está en uso.` });
      }

      // Validate client if changed
      if (client_id && client_id !== project.client_id) {
        const client = await db.Client.findByPk(client_id);
        if (!client) return res.status(400).json({ error: "Cliente no encontrado." });
      }

      await project.update({
        name: name !== undefined ? name : project.name,
        code: code !== undefined ? code : project.code,
        client_id: client_id !== undefined ? client_id : project.client_id,
        plant_id: plant_id !== undefined ? (plant_id || null) : project.plant_id,
        description: description !== undefined ? description : project.description,
        status: status !== undefined ? status : project.status,
        start_date: start_date !== undefined ? (start_date || null) : project.start_date,
        end_date: end_date !== undefined ? (end_date || null) : project.end_date,
        notes: notes !== undefined ? notes : project.notes,
      });

      return res.status(200).json({ data: project });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  destroy: async (req, res) => {
    try {
      const project = await db.Project.findByPk(req.params.id);
      if (!project) return res.status(404).json({ error: "Proyecto no encontrado." });

      const subprojectCount = await db.Project.count({ where: { parent_id: project.id } });
      if (subprojectCount > 0) {
        return res.status(400).json({
          error: `No se puede eliminar un proyecto con ${subprojectCount} subproyecto(s)/adicional(es) asociado(s).`,
        });
      }

      // Check if project has time entries
      const entryCount = await db.TimeEntry.count({
        where: { project_id: project.id, status: { [Op.in]: ["pending", "approved"] } },
      });

      if (entryCount > 0) {
        return res.status(400).json({
          error: `No se puede eliminar un proyecto con ${entryCount} registro(s) de horas. Cambie su estado a "cancelado" en su lugar.`,
        });
      }

      await project.destroy();
      return res.status(200).json({ message: "Proyecto eliminado." });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
  getSupervisors: async (req, res) => {
    try {
      const project = await db.Project.findByPk(req.params.id);
      if (!project) return res.status(404).json({ error: "Proyecto no encontrado." });

      const supervisors = await project.getSupervisors({
        attributes: ["id", "name", "lastname", "email", "phone", "is_active"],
        through: { attributes: [] }
      });
      return res.status(200).json({ data: supervisors });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  syncSupervisors: async (req, res) => {
    try {
      const { supervisor_ids } = req.body;
      if (!Array.isArray(supervisor_ids)) {
        return res.status(400).json({ error: "supervisor_ids debe ser un array." });
      }

      const project = await db.Project.findByPk(req.params.id);
      if (!project) return res.status(404).json({ error: "Proyecto no encontrado." });

      // Validate that all supervisors belong to the project's client
      const supervisors = await db.ClientSupervisor.findAll({
        where: {
          id: { [Op.in]: supervisor_ids },
          client_id: project.client_id
        }
      });

      if (supervisors.length !== supervisor_ids.length) {
        return res.status(400).json({ error: "Uno o más supervisores seleccionados no existen o no pertenecen al cliente del proyecto." });
      }

      await project.setSupervisors(supervisor_ids);

      const updatedSupervisors = await project.getSupervisors({ through: { attributes: [] } });

      return res.status(200).json({
        message: "Supervisores sincronizados correctamente.",
        data: updatedSupervisors
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // Reusado por budgetController para mostrar el consumo real por rubro (informativo) al lado
  // de las líneas de mano de obra de un presupuesto vinculado a un proyecto con horas cargadas.
  sumConsumedHoursByType,
};
