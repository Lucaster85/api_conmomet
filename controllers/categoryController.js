const db = require("../models");

module.exports = {
  getAll: async (req, res) => {
    try {
      const { guild_id } = req.query;
      const where = {};
      if (guild_id) {
        where.guild_id = guild_id;
      }
      const { count, rows } = await db.Category.findAndCountAll({
        where,
        include: [{ model: db.Guild, as: "guild" }],
        order: [["name", "ASC"]],
      });
      return res.status(200).json({ count, data: rows });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  get: async (req, res) => {
    try {
      const item = await db.Category.findByPk(req.params.id, {
        include: [{ model: db.Guild, as: "guild" }],
      });
      if (!item) return res.status(400).json({ error: "Categoría no encontrada." });
      return res.status(200).json({ data: item });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    try {
      const { name, guild_hourly_rate, guild_id } = req.body;
      if (!name || guild_hourly_rate === undefined || !guild_id) {
        return res.status(400).json({ error: "Nombre, valor hora y gremio son obligatorios." });
      }
      const item = await db.Category.create({ name, guild_hourly_rate, guild_id });
      return res.status(201).json({ data: item });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  update: async (req, res) => {
    try {
      const item = await db.Category.findByPk(req.params.id);
      if (!item) return res.status(400).json({ error: "Categoría no encontrada." });
      const { name, guild_hourly_rate, guild_id } = req.body;
      await item.update({ name, guild_hourly_rate, guild_id });
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
