const db = require("../models");

// "" o undefined -> null (sin vencimiento); un número -> ese número.
const parseNullableInt = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
};

module.exports = {
  getAll: async (req, res) => {
    try {
      const where = {};
      // By default only return active items, unless explicitly requested
      if (req.query.include_inactive !== "true") {
        where.is_active = true;
      }

      const items = await db.EppItem.findAll({
        where,
        order: [["category", "ASC"], ["name", "ASC"]],
      });
      return res.status(200).json({ data: items });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    const { name, category, size_type, lifespan_months, notify_days_before } = req.body;

    if (!name || !category) {
      return res.status(400).json({ error: "Nombre y categoría son obligatorios." });
    }

    try {
      const item = await db.EppItem.create({
        name,
        category,
        size_type: size_type || "none",
        lifespan_months: parseNullableInt(lifespan_months),
        notify_days_before: notify_days_before !== undefined ? parseNullableInt(notify_days_before) ?? 15 : 15,
      });
      return res.status(201).json({ data: item });
    } catch (error) {
      if (error.name === "SequelizeUniqueConstraintError") {
        return res.status(400).json({ error: "Ya existe un artículo con ese nombre." });
      }
      return res.status(500).json({ error: error.message });
    }
  },

  update: async (req, res) => {
    try {
      const item = await db.EppItem.findByPk(req.params.id);
      if (!item) return res.status(404).json({ error: "Artículo no encontrado." });

      const { name, category, size_type, lifespan_months, notify_days_before } = req.body;
      await item.update({
        name,
        category,
        size_type,
        lifespan_months: parseNullableInt(lifespan_months),
        notify_days_before: notify_days_before !== undefined ? parseNullableInt(notify_days_before) ?? 15 : 15,
      });

      return res.status(200).json({ data: item });
    } catch (error) {
      if (error.name === "SequelizeUniqueConstraintError") {
        return res.status(400).json({ error: "Ya existe un artículo con ese nombre." });
      }
      return res.status(500).json({ error: error.message });
    }
  },

  toggleActive: async (req, res) => {
    try {
      const item = await db.EppItem.findByPk(req.params.id);
      if (!item) return res.status(404).json({ error: "Artículo no encontrado." });

      await item.update({ is_active: !item.is_active });
      return res.status(200).json({ data: item });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
