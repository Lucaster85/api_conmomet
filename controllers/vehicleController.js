const db = require("../models");

module.exports = {
  getAll: async (req, res) => {
    try {
      const { type, is_active } = req.query;
      const where = {};

      if (type) where.type = type;
      if (is_active !== undefined) {
        where.is_active = is_active === "true" || is_active === true;
      }

      const { count, rows } = await db.Vehicle.findAndCountAll({
        where,
        order: [["brand", "ASC"], ["model", "ASC"], ["plate", "ASC"]],
      });
      return res.status(200).json({ count, data: rows });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  get: async (req, res) => {
    const { id } = req.params;
    try {
      const vehicle = await db.Vehicle.findByPk(id);
      if (!vehicle) {
        return res.status(404).json({ error: "Vehículo no encontrado." });
      }
      return res.status(200).json({ data: vehicle });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    const { brand, model, plate, type, is_active } = req.body;
    try {
      if (!plate) {
        return res.status(400).json({ error: "La patente (plate) es requerida." });
      }

      // Check duplicate plate
      const existing = await db.Vehicle.findOne({ where: { plate } });
      if (existing) {
        return res.status(400).json({ error: "Ya existe un vehículo registrado con esta patente." });
      }

      const vehicle = await db.Vehicle.create({
        brand,
        model,
        plate: plate.toUpperCase(),
        type: type || "other",
        is_active: is_active !== undefined ? is_active : true,
      });

      return res.status(201).json({ vehicle });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  },

  update: async (req, res) => {
    const { id } = req.params;
    const { brand, model, plate, type, is_active } = req.body;
    try {
      const vehicle = await db.Vehicle.findByPk(id);
      if (!vehicle) {
        return res.status(404).json({ error: "Vehículo no encontrado." });
      }

      if (plate && plate.toUpperCase() !== vehicle.plate) {
        const existing = await db.Vehicle.findOne({ where: { plate: plate.toUpperCase() } });
        if (existing) {
          return res.status(400).json({ error: "Ya existe otro vehículo registrado con esta patente." });
        }
        vehicle.plate = plate.toUpperCase();
      }

      if (brand !== undefined) vehicle.brand = brand;
      if (model !== undefined) vehicle.model = model;
      if (type !== undefined) vehicle.type = type;
      if (is_active !== undefined) vehicle.is_active = is_active;

      await vehicle.save();
      return res.status(200).json(vehicle);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  destroy: async (req, res) => {
    const { id } = req.params;
    try {
      const vehicle = await db.Vehicle.findByPk(id);
      if (!vehicle) {
        return res.status(404).json({ error: "Vehículo no encontrado." });
      }

      await vehicle.destroy();
      return res.status(200).json("Vehículo eliminado correctamente.");
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
