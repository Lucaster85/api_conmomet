const db = require("../models");

module.exports = {
  getAll: async (req, res) => {
    try {
      const { year, status } = req.query;
      const where = {};
      if (year) where.year = year;
      if (status) where.status = status;

      const { count, rows } = await db.PayPeriod.findAndCountAll({
        where,
        include: [{ model: db.User, as: "closedBy", attributes: ["id", "name", "lastname"] }],
        order: [["year", "DESC"], ["month", "DESC"], ["type", "DESC"]],
      });
      return res.status(200).json({ count, data: rows });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    const { month, year, type } = req.body;

    if (!month || !year || !type) {
      return res.status(400).json({ error: "Mes, año y tipo son obligatorios." });
    }

    try {
      // Calculate dates
      const lastDay = new Date(year, month, 0).getDate();
      const start_date = type === "first_half" ? `${year}-${String(month).padStart(2, "0")}-01` : `${year}-${String(month).padStart(2, "0")}-16`;
      const end_date = type === "first_half" ? `${year}-${String(month).padStart(2, "0")}-15` : `${year}-${String(month).padStart(2, "0")}-${lastDay}`;

      // Check if already exists
      const existing = await db.PayPeriod.findOne({ where: { month, year, type } });
      if (existing) return res.status(400).json({ error: "Ya existe una quincena para ese período." });

      const period = await db.PayPeriod.create({ start_date, end_date, type, month, year });
      return res.status(201).json({ data: period });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  close: async (req, res) => {
    try {
      const period = await db.PayPeriod.findByPk(req.params.id);
      if (!period) return res.status(404).json({ error: "Quincena no encontrada." });
      if (period.status !== "open") return res.status(400).json({ error: "Solo se pueden cerrar quincenas abiertas." });

      await period.update({
        status: "closed",
        closed_by: req.user.id,
        closed_at: new Date(),
      });

      return res.status(200).json({ data: period });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  pay: async (req, res) => {
    try {
      const period = await db.PayPeriod.findByPk(req.params.id);
      if (!period) return res.status(404).json({ error: "Quincena no encontrada." });
      if (period.status !== "closed") return res.status(400).json({ error: "Solo se pueden pagar quincenas cerradas." });

      await period.update({ status: "paid" });

      // Mark all draft/confirmed payroll entries as paid
      await db.PayrollEntry.update(
        { status: "paid", paid_at: new Date() },
        { where: { pay_period_id: period.id, status: { [require("sequelize").Op.ne]: "paid" } } }
      );

      return res.status(200).json({ data: period });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
