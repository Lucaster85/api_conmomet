const db = require("../models");

module.exports = {
  getAll: async (req, res) => {
    try {
      const where = {};
      if (req.query.active === "true") where.is_active = true;
      const concepts = await db.PayrollConcept.findAll({ where, order: [["sort_order", "ASC"], ["name", "ASC"]] });
      return res.status(200).json({ count: concepts.length, data: concepts });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    try {
      const { name, code, calc_type, sort_order } = req.body;
      if (!name || !code) {
        return res.status(400).json({ error: "Nombre y código son obligatorios." });
      }
      const concept = await db.PayrollConcept.create({ name, code, calc_type: calc_type || "hourly", sort_order: sort_order || 0 });
      return res.status(201).json({ data: concept });
    } catch (error) {
      if (error.name === "SequelizeUniqueConstraintError") {
        return res.status(400).json({ error: "Ya existe un concepto con ese código." });
      }
      return res.status(400).json({ error: error.message });
    }
  },

  update: async (req, res) => {
    try {
      const concept = await db.PayrollConcept.findByPk(req.params.id);
      if (!concept) return res.status(404).json({ error: "Concepto no encontrado." });
      const { name, code, calc_type, sort_order, is_active } = req.body;
      await concept.update({ name, code, calc_type, sort_order, is_active });
      return res.status(200).json({ data: concept });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  },

  destroy: async (req, res) => {
    try {
      const concept = await db.PayrollConcept.findByPk(req.params.id);
      if (!concept) return res.status(404).json({ error: "Concepto no encontrado." });
      await concept.destroy();
      return res.status(200).json({ message: "Concepto eliminado." });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
