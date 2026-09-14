const db = require("../models");

module.exports = {
  getAll: async (req, res) => {
    try {
      const { is_active } = req.query;
      const where = {};
      if (is_active !== undefined) where.is_active = is_active === "true";

      const items = await db.ToolType.findAll({
        where,
        order: [["name", "ASC"]],
      });
      return res.status(200).json({ data: items });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    try {
      const { name, is_active } = req.body;
      if (!name) {
        return res.status(400).json({ error: "El nombre del tipo de herramienta es obligatorio." });
      }
      const normalizedName = name.trim();

      // Buscar o crear por nombre (case-insensitive), incluyendo soft-eliminados: evita que
      // el autocomplete "creatable" del alta rápida choque con la unique constraint en vez de
      // simplemente resolver al tipo ya existente (mismo criterio que materialUnitController).
      const existing = await db.ToolType.findOne({
        where: db.sequelize.where(
          db.sequelize.fn("LOWER", db.sequelize.col("name")),
          normalizedName.toLowerCase()
        ),
        paranoid: false,
      });

      if (existing) {
        if (existing.deleted_at) {
          await existing.restore();
          await existing.update({ is_active: true });
        }
        return res.status(200).json({ data: existing });
      }

      const item = await db.ToolType.create({
        name: normalizedName,
        is_active: is_active !== undefined ? is_active : true,
      });
      return res.status(201).json({ data: item });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  update: async (req, res) => {
    try {
      const item = await db.ToolType.findByPk(req.params.id);
      if (!item) return res.status(404).json({ error: "Tipo de herramienta no encontrado." });

      const { name, is_active } = req.body;
      await item.update({
        name: name !== undefined ? name : item.name,
        is_active: is_active !== undefined ? is_active : item.is_active,
      });
      return res.status(200).json({ data: item });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  destroy: async (req, res) => {
    try {
      const item = await db.ToolType.findByPk(req.params.id);
      if (!item) return res.status(404).json({ error: "Tipo de herramienta no encontrado." });

      const usageCount = await db.Tool.count({ where: { tool_type_id: item.id } });
      if (usageCount > 0) {
        return res.status(400).json({ error: `No se puede eliminar: está usado en ${usageCount} herramienta(s). Desactívelo en su lugar.` });
      }

      await item.destroy();
      return res.status(200).json({ message: "Tipo de herramienta eliminado." });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
