const { Op, fn, col, literal } = require("sequelize");
const db = require("../models");
const { generateProjectCode } = require("../services/projectFactory");
const { userHasPermission, computeTotalsByCurrency } = require("../helpers");

async function sumConsumedHours(projectIds) {
  if (projectIds.length === 0) return new Map();
  const rows = await db.TimeEntry.findAll({
    where: { project_id: { [Op.in]: projectIds }, status: "approved" },
    attributes: [
      "project_id",
      [fn("SUM", col("regular_hours")), "total_regular"],
      [fn("SUM", col("overtime_50_hours")), "total_50"],
      [fn("SUM", col("overtime_100_hours")), "total_100"],
    ],
    group: ["project_id"],
  });

  const map = new Map();
  for (const row of rows) {
    const reg = parseFloat(row.getDataValue("total_regular") || 0);
    const ot50 = parseFloat(row.getDataValue("total_50") || 0);
    const ot100 = parseFloat(row.getDataValue("total_100") || 0);
    map.set(row.project_id, reg + ot50 * 0.5 + ot100 * 1.0);
  }
  return map;
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
      const consumedMap = await sumConsumedHours([...allRelevantIds]);

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
        const ownHours = consumedMap.get(p.id) || 0;
        const childrenHours = (p.subprojects || []).reduce((sum, sp) => sum + (consumedMap.get(sp.id) || 0), 0);

        pData.subproject_count = (p.subprojects || []).length;
        delete pData.subprojects;
        pData.consumed_hours_own = ownHours;
        pData.consumed_hours_total = ownHours + childrenHours;
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
          { model: db.Project, as: "subprojects", attributes: ["id", "name", "code", "status", "budgeted_hours"] },
        ],
      });

      if (!project) return res.status(404).json({ error: "Proyecto no encontrado." });

      const pData = project.toJSON();

      const childIds = (project.subprojects || []).map((sp) => sp.id);
      const consumedMap = await sumConsumedHours([project.id, ...childIds]);

      const ownHours = consumedMap.get(project.id) || 0;
      const childrenHours = childIds.reduce((sum, id) => sum + (consumedMap.get(id) || 0), 0);

      pData.consumed_hours_own = ownHours;
      pData.consumed_hours_total = ownHours + childrenHours;
      pData.subprojects = (project.subprojects || []).map((sp) => ({
        ...sp.toJSON(),
        consumed_hours_own: consumedMap.get(sp.id) || 0,
      }));

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
          // material_cost_snapshot/currency viajan en BudgetMaterialItem aunque no se incluya
          // Material — hay que pelarlos acá también si no tiene material_costs_read (mismo
          // criterio que budgetController.js#withTotals).
          if (!userHasPermission(req.user, "material_costs_read")) {
            budgetData.materialItems = (budgetData.materialItems || []).map((item) => {
              const { material_cost_snapshot, material_cost_currency, ...rest } = item;
              return rest;
            });
          }
          pData.budget = budgetData;
        } else {
          pData.budget = null;
        }
      } else {
        delete pData.budgeted_hours;
      }

      return res.status(200).json({ data: pData });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    try {
      const { name, code, client_id, plant_id, description, budgeted_hours, status, start_date, end_date, notes, parent_id } = req.body;

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
        budgeted_hours: budgeted_hours || 0,
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

      const { name, code, client_id, plant_id, description, budgeted_hours, status, start_date, end_date, notes } = req.body;

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
        budgeted_hours: budgeted_hours !== undefined ? budgeted_hours : project.budgeted_hours,
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
};
