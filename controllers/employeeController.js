const db = require("../models");

module.exports = {
  getAll: async (req, res) => {
    try {
      const { status } = req.query;
      const where = {};
      if (status) where.status = status;

      const { count, rows } = await db.Employee.findAndCountAll({
        where,
        include: [{ model: db.User, as: "user", attributes: ["id", "email", "name", "lastname"] }],
        order: [["lastname", "ASC"], ["name", "ASC"]],
      });
      return res.status(200).json({ count, data: rows });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  get: async (req, res) => {
    try {
      const employee = await db.Employee.findByPk(req.params.id, {
        include: [
          { model: db.User, as: "user", attributes: ["id", "email", "name", "lastname"] },
          { model: db.EmployeeDocument, as: "documents", order: [["created_at", "DESC"]] },
        ],
      });
      if (!employee) return res.status(404).json({ error: "Empleado no encontrado." });
      return res.status(200).json({ data: employee });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    const { name, lastname, dni, cuil, address, phone, email, position, hire_date, hourly_rate, user_id, notes } = req.body;

    if (!name || !lastname || !dni || !cuil || !hire_date || !hourly_rate) {
      return res.status(400).json({ error: "Nombre, apellido, DNI, CUIL, fecha de ingreso y valor hora son obligatorios." });
    }

    try {
      const employee = await db.Employee.create({
        name, lastname, dni, cuil, address, phone, email, position, hire_date, hourly_rate, user_id, notes,
      });
      return res.status(201).json({ data: employee });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  },

  update: async (req, res) => {
    try {
      const employee = await db.Employee.findByPk(req.params.id);
      if (!employee) return res.status(404).json({ error: "Empleado no encontrado." });

      const { name, lastname, dni, cuil, address, phone, email, position, hire_date, termination_date, status, hourly_rate, user_id, notes } = req.body;
      await employee.update({
        name, lastname, dni, cuil, address, phone, email, position, hire_date, termination_date, status, hourly_rate, user_id, notes,
      });

      return res.status(200).json({ data: employee });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  destroy: async (req, res) => {
    try {
      const employee = await db.Employee.findByPk(req.params.id);
      if (!employee) return res.status(404).json({ error: "Empleado no encontrado." });

      await employee.destroy();
      return res.status(200).json({ message: "Empleado eliminado correctamente." });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
