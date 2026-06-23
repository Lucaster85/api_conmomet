const { Op, fn, col, literal } = require("sequelize");
const db = require("../models");

/**
 * Auto-generates a project code like P-2026-001
 */
async function generateProjectCode() {
  const year = new Date().getFullYear();
  const prefix = `P-${year}-`;

  const lastProject = await db.Project.findOne({
    where: { code: { [Op.like]: `${prefix}%` } },
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

module.exports = {
  getAll: async (req, res) => {
    try {
      const { client_id, status, plant_id } = req.query;
      const where = {};

      if (client_id) where.client_id = client_id;
      if (plant_id) where.plant_id = plant_id;
      if (status) where.status = status;

      const projects = await db.Project.findAll({
        where,
        include: [
          { model: db.Client, as: "client", attributes: ["id", "razonSocial"] },
          { model: db.Plant, as: "plant", attributes: ["id", "name"] },
          { model: db.ClientSupervisor, as: "supervisors", attributes: ["id", "name", "lastname"], through: { attributes: [] } },
        ],
        order: [["created_at", "DESC"]],
      });

      const projectIds = projects.map(p => p.id);
      let timeEntriesAgg = [];
      
      if (projectIds.length > 0) {
        timeEntriesAgg = await db.TimeEntry.findAll({
          where: { project_id: { [Op.in]: projectIds }, status: "approved" },
          attributes: [
            "project_id",
            [fn("SUM", col("regular_hours")), "total_regular"],
            [fn("SUM", col("overtime_50_hours")), "total_50"],
            [fn("SUM", col("overtime_100_hours")), "total_100"],
          ],
          group: ["project_id"],
        });
      }

      const result = projects.map(p => {
        const pData = p.toJSON();
        const agg = timeEntriesAgg.find(t => t.project_id === p.id);
        let consumed = 0;
        if (agg) {
          const reg = parseFloat(agg.getDataValue("total_regular") || 0);
          const ot50 = parseFloat(agg.getDataValue("total_50") || 0);
          const ot100 = parseFloat(agg.getDataValue("total_100") || 0);
          consumed = reg + (ot50 * 0.5) + (ot100 * 1.0);
        }
        pData.consumed_hours = consumed;
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
        ],
      });

      if (!project) return res.status(404).json({ error: "Proyecto no encontrado." });

      const pData = project.toJSON();

      // Pure ORM calculation for consumed hours
      const timeEntriesAgg = await db.TimeEntry.findAll({
        where: { project_id: project.id, status: "approved" },
        attributes: [
          [fn("SUM", col("regular_hours")), "total_regular"],
          [fn("SUM", col("overtime_50_hours")), "total_50"],
          [fn("SUM", col("overtime_100_hours")), "total_100"],
        ],
      });

      let consumed = 0;
      if (timeEntriesAgg && timeEntriesAgg.length > 0) {
        const agg = timeEntriesAgg[0];
        const reg = parseFloat(agg.getDataValue("total_regular") || 0);
        const ot50 = parseFloat(agg.getDataValue("total_50") || 0);
        const ot100 = parseFloat(agg.getDataValue("total_100") || 0);
        consumed = reg + (ot50 * 0.5) + (ot100 * 1.0);
      }
      pData.consumed_hours = consumed;

      return res.status(200).json({ data: pData });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    try {
      const { name, code, client_id, plant_id, description, budgeted_hours, status, start_date, end_date, notes } = req.body;

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
