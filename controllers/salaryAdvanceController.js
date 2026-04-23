const db = require("../models");

module.exports = {
  getAll: async (req, res) => {
    try {
      const { employee_id, pay_period_id } = req.query;
      const where = {};
      if (employee_id) where.employee_id = employee_id;
      if (pay_period_id) where.pay_period_id = pay_period_id;

      const { count, rows } = await db.SalaryAdvance.findAndCountAll({
        where,
        include: [
          { model: db.Employee, as: "employee", attributes: ["id", "name", "lastname"] },
          { model: db.PayPeriod, as: "payPeriod", attributes: ["id", "month", "year", "type"] },
          { model: db.User, as: "approvedBy", attributes: ["id", "name", "lastname"] },
        ],
        order: [["date", "DESC"]],
      });
      return res.status(200).json({ count, data: rows });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    const { employee_id, amount, date, pay_period_id, notes } = req.body;

    if (!employee_id || !amount || !date) {
      return res.status(400).json({ error: "Empleado, monto y fecha son obligatorios." });
    }

    try {
      const employee = await db.Employee.findByPk(employee_id);
      if (!employee) return res.status(404).json({ error: "Empleado no encontrado." });

      const advance = await db.SalaryAdvance.create({
        employee_id, amount, date, pay_period_id, notes,
        approved_by: req.user.id,
      });

      return res.status(201).json({ data: advance });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  update: async (req, res) => {
    try {
      const advance = await db.SalaryAdvance.findByPk(req.params.id);
      if (!advance) return res.status(404).json({ error: "Adelanto no encontrado." });

      const { amount, date, pay_period_id, notes } = req.body;
      await advance.update({ amount, date, pay_period_id, notes });

      return res.status(200).json({ data: advance });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
