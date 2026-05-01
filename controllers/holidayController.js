const db = require("../models");

module.exports = {
  getAll: async (req, res) => {
    try {
      const { year } = req.query;
      const where = {};
      if (year) {
        const { Op } = require("sequelize");
        where.date = {
          [Op.between]: [`${year}-01-01`, `${year}-12-31`],
        };
      }
      const holidays = await db.Holiday.findAll({ where, order: [["date", "ASC"]] });
      return res.status(200).json({ count: holidays.length, data: holidays });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    try {
      const { date, name } = req.body;
      if (!date || !name) {
        return res.status(400).json({ error: "Fecha y nombre son obligatorios." });
      }
      const holiday = await db.Holiday.create({ date, name });
      return res.status(201).json({ data: holiday });
    } catch (error) {
      if (error.name === "SequelizeUniqueConstraintError") {
        return res.status(400).json({ error: "Ya existe un feriado para esa fecha." });
      }
      return res.status(400).json({ error: error.message });
    }
  },

  bulkCreate: async (req, res) => {
    try {
      const { holidays } = req.body;
      if (!Array.isArray(holidays) || holidays.length === 0) {
        return res.status(400).json({ error: "Debe enviar un array de feriados." });
      }
      const created = await db.Holiday.bulkCreate(holidays, { ignoreDuplicates: true });
      return res.status(201).json({ count: created.length, data: created });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  },

  update: async (req, res) => {
    try {
      const holiday = await db.Holiday.findByPk(req.params.id);
      if (!holiday) return res.status(404).json({ error: "Feriado no encontrado." });
      const { date, name } = req.body;
      await holiday.update({ date, name });
      return res.status(200).json({ data: holiday });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  },

  destroy: async (req, res) => {
    try {
      const holiday = await db.Holiday.findByPk(req.params.id);
      if (!holiday) return res.status(404).json({ error: "Feriado no encontrado." });
      await holiday.destroy();
      return res.status(200).json({ message: "Feriado eliminado." });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
