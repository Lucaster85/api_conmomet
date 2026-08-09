const db = require("../models");

module.exports = {
  getAll: async (req, res) => {
    try {
      const { is_active } = req.query;
      const where = {};
      if (is_active !== undefined) where.is_active = is_active === "true";

      const items = await db.MaterialUnit.findAll({
        where,
        order: [["display_order", "ASC"], ["label", "ASC"]],
      });
      return res.status(200).json({ data: items });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    try {
      const { label, display_order, is_active } = req.body;
      if (!label) {
        return res.status(400).json({ error: "La etiqueta de la unidad es obligatoria." });
      }
      const normalizedLabel = label.trim();

      // Buscar o crear por etiqueta (case-insensitive), incluyendo soft-eliminadas: evita que
      // un retry de importación (o un alta concurrente desde el autocomplete "creatable") choque
      // con la unique constraint en vez de simplemente resolver a la unidad ya existente.
      const existing = await db.MaterialUnit.findOne({
        where: db.sequelize.where(
          db.sequelize.fn("LOWER", db.sequelize.col("label")),
          normalizedLabel.toLowerCase()
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

      const item = await db.MaterialUnit.create({
        label: normalizedLabel,
        display_order: display_order || 0,
        is_active: is_active !== undefined ? is_active : true,
      });
      return res.status(201).json({ data: item });
    } catch (error) {
      if (error.name === "SequelizeUniqueConstraintError") {
        return res.status(400).json({ error: `Ya existe una unidad con la etiqueta "${req.body.label}".` });
      }
      return res.status(500).json({ error: error.message });
    }
  },

  update: async (req, res) => {
    try {
      const item = await db.MaterialUnit.findByPk(req.params.id);
      if (!item) return res.status(404).json({ error: "Unidad de medida no encontrada." });

      const { label, display_order, is_active } = req.body;
      await item.update({
        label: label !== undefined ? label : item.label,
        display_order: display_order !== undefined ? display_order : item.display_order,
        is_active: is_active !== undefined ? is_active : item.is_active,
      });
      return res.status(200).json({ data: item });
    } catch (error) {
      if (error.name === "SequelizeUniqueConstraintError") {
        return res.status(400).json({ error: `Ya existe una unidad con esa etiqueta.` });
      }
      return res.status(500).json({ error: error.message });
    }
  },

  destroy: async (req, res) => {
    try {
      const item = await db.MaterialUnit.findByPk(req.params.id);
      if (!item) return res.status(404).json({ error: "Unidad de medida no encontrada." });

      const usageCount = await db.BudgetMaterialItem.count({ where: { material_unit_id: item.id } });
      if (usageCount > 0) {
        return res.status(400).json({ error: `No se puede eliminar: está usada en ${usageCount} línea(s) de material. Desactívela en su lugar.` });
      }

      await item.destroy();
      return res.status(200).json({ message: "Unidad de medida eliminada." });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
