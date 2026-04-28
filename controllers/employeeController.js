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
          { model: db.EntityDocument, as: "documents" },
        ],
      });
      if (!employee) return res.status(404).json({ error: "Empleado no encontrado." });
      return res.status(200).json({ data: employee });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    const { name, lastname, dni, cuil, address, phone, email, position, hire_date, hourly_rate, pay_type, monthly_salary, user_id, notes, shoe_size, shirt_size, pant_size } = req.body;

    if (!name || !lastname || !dni || !cuil || !hire_date) {
      return res.status(400).json({ error: "Nombre, apellido, DNI, CUIL y fecha de ingreso son obligatorios." });
    }

    const resolvedPayType = pay_type || "hourly";
    if (resolvedPayType === "monthly" && !monthly_salary) {
      return res.status(400).json({ error: "El sueldo mensual es obligatorio para empleados mensualizados." });
    }
    if (resolvedPayType === "hourly" && !hourly_rate) {
      return res.status(400).json({ error: "El valor hora es obligatorio para empleados por hora." });
    }

    try {
      const employee = await db.Employee.create({
        name, lastname, dni, cuil, address, phone, email, position, hire_date,
        hourly_rate, pay_type: pay_type || "hourly", monthly_salary, user_id, notes,
        shoe_size, shirt_size, pant_size,
      });
      return res.status(201).json({ data: employee });
    } catch (error) {
      if (error.name === 'SequelizeUniqueConstraintError') {
        const field = error.errors?.[0]?.path;
        if (field === 'dni') {
          return res.status(400).json({ error: "El DNI ingresado ya se encuentra registrado." });
        }
        if (field === 'cuil') {
          return res.status(400).json({ error: "El CUIL ingresado ya se encuentra registrado." });
        }
        return res.status(400).json({ error: `El valor ingresado para "${field}" ya existe en el sistema.` });
      }
      return res.status(400).json({ error: error.message });
    }
  },

  update: async (req, res) => {
    try {
      const employee = await db.Employee.findByPk(req.params.id);
      if (!employee) return res.status(404).json({ error: "Empleado no encontrado." });

      const { name, lastname, dni, cuil, address, phone, email, position, hire_date, termination_date, status, hourly_rate, pay_type, monthly_salary, user_id, notes, shoe_size, shirt_size, pant_size } = req.body;

      // Auto-log salary changes
      const today = new Date().toISOString().split("T")[0];
      const userId = req.user?.id || null;

      if (hourly_rate !== undefined && Number(hourly_rate) !== Number(employee.hourly_rate)) {
        await db.SalaryHistory.create({
          employee_id: employee.id,
          field_changed: "hourly_rate",
          previous_value: employee.hourly_rate,
          new_value: hourly_rate,
          effective_date: today,
          changed_by: userId,
          notes: req.body.salary_change_notes || null,
        });
      }

      if (monthly_salary !== undefined && Number(monthly_salary) !== Number(employee.monthly_salary || 0)) {
        await db.SalaryHistory.create({
          employee_id: employee.id,
          field_changed: "monthly_salary",
          previous_value: employee.monthly_salary,
          new_value: monthly_salary,
          effective_date: today,
          changed_by: userId,
          notes: req.body.salary_change_notes || null,
        });
      }

      await employee.update({
        name, lastname, dni, cuil, address, phone, email, position, hire_date, termination_date, status,
        hourly_rate, pay_type, monthly_salary, user_id, notes,
        shoe_size, shirt_size, pant_size,
      });

      return res.status(200).json({ data: employee });
    } catch (error) {
      if (error.name === 'SequelizeUniqueConstraintError') {
        const field = error.errors?.[0]?.path;
        if (field === 'dni') {
          return res.status(400).json({ error: "El DNI ingresado ya se encuentra registrado." });
        }
        if (field === 'cuil') {
          return res.status(400).json({ error: "El CUIL ingresado ya se encuentra registrado." });
        }
        return res.status(400).json({ error: `El valor ingresado para "${field}" ya existe en el sistema.` });
      }
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
