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
        ],
        attributes: {
          include: [
            [
              literal(`(
                SELECT COALESCE(SUM(te.regular_hours + te.overtime_50_hours + te.overtime_100_hours), 0)
                FROM TimeEntries AS te
                WHERE te.project_id = Project.id
                  AND te.status = 'approved'
                  AND te.deleted_at IS NULL
              )`),
              "consumed_hours",
            ],
          ],
        },
        order: [["created_at", "DESC"]],
      });

      return res.status(200).json({ data: projects });
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
        ],
        attributes: {
          include: [
            [
              literal(`(
                SELECT COALESCE(SUM(te.regular_hours + te.overtime_50_hours + te.overtime_100_hours), 0)
                FROM TimeEntries AS te
                WHERE te.project_id = Project.id
                  AND te.status = 'approved'
                  AND te.deleted_at IS NULL
              )`),
              "consumed_hours",
            ],
          ],
        },
      });

      if (!project) return res.status(404).json({ error: "Proyecto no encontrado." });

      return res.status(200).json({ data: project });
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
        where: { project_id: project.id, status: { [Op.ne]: "voided" } },
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
};
