const db = require("../models");

module.exports = {
  getAll: async (req, res) => {
    try {
      const { count, rows } = await db.Category.findAndCountAll({
        order: [["name", "ASC"]],
      });
      return res.status(200).json({ count, data: rows });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  get: async (req, res) => {
    try {
      const item = await db.Category.findByPk(req.params.id);
      if (!item) return res.status(400).json({ error: "Categoría no encontrada." });
      return res.status(200).json({ data: item });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    try {
      const { name, guild_hourly_rate } = req.body;
      if (!name || guild_hourly_rate === undefined) {
        return res.status(400).json({ error: "Nombre y valor hora gremio son obligatorios." });
      }
      const item = await db.Category.create({ name, guild_hourly_rate });
      return res.status(201).json({ data: item });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  update: async (req, res) => {
    try {
      const item = await db.Category.findByPk(req.params.id);
      if (!item) return res.status(400).json({ error: "Categoría no encontrada." });
      const { name, guild_hourly_rate } = req.body;
      await item.update({ name, guild_hourly_rate });
      return res.status(200).json({ data: item });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  destroy: async (req, res) => {
    try {
      const item = await db.Category.findByPk(req.params.id);
      if (!item) return res.status(400).json({ error: "Categoría no encontrada." });
      await item.destroy();
      return res.status(200).json({ message: "Categoría eliminada correctamente." });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
