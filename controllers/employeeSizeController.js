const db = require("../models");

module.exports = {
  list: async (req, res) => {
    try {
      const sizes = await db.EmployeeSize.findAll({
        where: { employee_id: req.params.id },
        include: [{ model: db.EppItem, as: "eppItem", attributes: ["id", "name", "category", "size_type"] }],
      });
      return res.status(200).json({ data: sizes });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  upsert: async (req, res) => {
    const { epp_item_id, size } = req.body;

    if (!epp_item_id) {
      return res.status(400).json({ error: "El artículo es obligatorio." });
    }

    try {
      const eppItem = await db.EppItem.findByPk(epp_item_id);
      if (!eppItem) return res.status(404).json({ error: "Artículo de EPP no encontrado." });
      if (eppItem.size_type === "none") {
        return res.status(400).json({ error: "Este artículo no tiene talle." });
      }

      if (!size) {
        await db.EmployeeSize.destroy({ where: { employee_id: req.params.id, epp_item_id } });
        return res.status(200).json({ data: null });
      }

      await db.EmployeeSize.upsert({ employee_id: req.params.id, epp_item_id, size });

      const updated = await db.EmployeeSize.findOne({
        where: { employee_id: req.params.id, epp_item_id },
        include: [{ model: db.EppItem, as: "eppItem", attributes: ["id", "name", "category", "size_type"] }],
      });

      return res.status(200).json({ data: updated });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
