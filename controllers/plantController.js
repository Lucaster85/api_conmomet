const db = require("../models");

module.exports = {
  getAll: async (req, res) => {
    try {
      const { count, rows } = await db.Plant.findAndCountAll({
        include: [{ model: db.Client, as: "client", attributes: ["id", "razonSocial"] }],
        order: [["name", "ASC"]],
      });
      return res.status(200).json({ count, data: rows });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  get: async (req, res) => {
    try {
      const plant = await db.Plant.findByPk(req.params.id, {
        include: [{ model: db.Client, as: "client" }],
      });
      if (!plant) return res.status(404).json({ error: "Planta no encontrada." });
      return res.status(200).json({ data: plant });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    const { name, address, client_id, notes } = req.body;

    if (!name) return res.status(400).json({ error: "El nombre es obligatorio." });

    try {
      const plant = await db.Plant.create({ name, address, client_id, notes });
      return res.status(201).json({ data: plant });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  },

  update: async (req, res) => {
    try {
      const plant = await db.Plant.findByPk(req.params.id);
      if (!plant) return res.status(404).json({ error: "Planta no encontrada." });

      const { name, address, client_id, is_active, notes } = req.body;
      await plant.update({ name, address, client_id, is_active, notes });

      return res.status(200).json({ data: plant });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  destroy: async (req, res) => {
    try {
      const plant = await db.Plant.findByPk(req.params.id);
      if (!plant) return res.status(404).json({ error: "Planta no encontrada." });

      await plant.destroy();
      return res.status(200).json({ message: "Planta eliminada correctamente." });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
