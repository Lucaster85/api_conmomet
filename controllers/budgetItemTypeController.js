const db = require("../models");

module.exports = {
  getAll: async (req, res) => {
    try {
      const { is_active } = req.query;
      const where = {};
      if (is_active !== undefined) where.is_active = is_active === "true";

      const items = await db.BudgetItemType.findAll({
        where,
        order: [["display_order", "ASC"], ["name", "ASC"]],
      });
      return res.status(200).json({ data: items });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    try {
      const { name, unit_type, unit_label, display_order, is_active } = req.body;
      if (!name || !unit_type) {
        return res.status(400).json({ error: "Nombre y tipo de unidad son obligatorios." });
      }
      const item = await db.BudgetItemType.create({
        name,
        unit_type,
        unit_label: unit_label || "hs",
        display_order: display_order || 0,
        is_active: is_active !== undefined ? is_active : true,
      });
      return res.status(201).json({ data: item });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  update: async (req, res) => {
    try {
      const item = await db.BudgetItemType.findByPk(req.params.id);
      if (!item) return res.status(404).json({ error: "Rubro de presupuesto no encontrado." });

      const { name, unit_type, unit_label, display_order, is_active } = req.body;
      await item.update({
        name: name !== undefined ? name : item.name,
        unit_type: unit_type !== undefined ? unit_type : item.unit_type,
        unit_label: unit_label !== undefined ? unit_label : item.unit_label,
        display_order: display_order !== undefined ? display_order : item.display_order,
        is_active: is_active !== undefined ? is_active : item.is_active,
      });
      return res.status(200).json({ data: item });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  destroy: async (req, res) => {
    try {
      const item = await db.BudgetItemType.findByPk(req.params.id);
      if (!item) return res.status(404).json({ error: "Rubro de presupuesto no encontrado." });

      const usageCount = await db.BudgetLaborLine.count({ where: { budget_item_type_id: item.id } });
      if (usageCount > 0) {
        return res.status(400).json({ error: `No se puede eliminar: está usado en ${usageCount} línea(s) de presupuesto. Desactívelo en su lugar.` });
      }

      await item.destroy();
      return res.status(200).json({ message: "Rubro de presupuesto eliminado." });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
