const db = require("../models");
const { getInvitationStatus } = require("./employeeInvitationController");
const { userHasPermission } = require("../helpers");

// Separado de employees_read a propósito (ver helpers/seed.js#employee_salaries_read, mismo
// criterio que budget_prices_read): borra los montos de sueldo antes de serializar, no solo los
// oculta en el front. pay_type (la modalidad) no es sensible y queda siempre visible.
function stripSalaryFields(json) {
  const { hourly_rate, monthly_salary, ...rest } = json;
  if (rest.category) {
    const { guild_hourly_rate, ...restCategory } = rest.category;
    rest.category = restCategory;
  }
  return rest;
}

module.exports = {
  getAll: async (req, res) => {
    try {
      const { status, include_inactive } = req.query;
      const where = {};
      if (status) {
        where.status = status;
      } else if (include_inactive !== "true") {
        const { Op } = require("sequelize");
        where.status = { [Op.ne]: "inactive" };
      }

      const { count, rows } = await db.Employee.findAndCountAll({
        where,
        include: [
          { model: db.User, as: "user", attributes: ["id", "email", "name", "lastname"] },
          { model: db.Category, as: "category", attributes: ["id", "name", "guild_hourly_rate"] },
        ],
        order: [
          ["lastname", "ASC"],
          ["name", "ASC"]
        ],
      });

      const pendingInvitations = await db.EmployeeInvitation.findAll({
        where: { employee_id: rows.map((r) => r.id), accepted_at: null },
        order: [["createdAt", "DESC"]],
      });
      const latestInvitationByEmployee = new Map();
      for (const invitation of pendingInvitations) {
        if (!latestInvitationByEmployee.has(invitation.employee_id)) {
          latestInvitationByEmployee.set(invitation.employee_id, invitation);
        }
      }

      const canSeeSalaries = userHasPermission(req.user, "employee_salaries_read");

      const data = rows.map((r) => {
        let json = r.toJSON();
        if (!canSeeSalaries) json = stripSalaryFields(json);
        const latest = latestInvitationByEmployee.get(r.id);
        json.invitation_status = latest ? getInvitationStatus(latest) : null;
        return json;
      });

      return res.status(200).json({ count, data });
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
          { model: db.Category, as: "category", attributes: ["id", "name", "guild_hourly_rate"] },
          { model: db.EmployeeSize, as: "sizes", include: [{ model: db.EppItem, as: "eppItem", attributes: ["id", "name", "category", "size_type"] }] },
        ],
      });
      if (!employee) return res.status(404).json({ error: "Empleado no encontrado." });

      const canSeeSalaries = userHasPermission(req.user, "employee_salaries_read");
      const data = canSeeSalaries ? employee : stripSalaryFields(employee.toJSON());

      return res.status(200).json({ data });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    const { name, lastname, dni, cuil, address, phone, email, position, hire_date, hourly_rate, pay_type, monthly_salary, user_id, category_id, notes, shoe_size, shirt_size, pant_size, vacation_days_override, birth_date } = req.body;

    if (!name || !lastname || !dni || !cuil || !hire_date) {
      return res.status(400).json({ error: "Nombre, apellido, DNI, CUIL y fecha de ingreso son obligatorios." });
    }

    const resolvedPayType = pay_type || "hourly";
    if ((resolvedPayType === "monthly" || resolvedPayType === "biweekly_fixed") && !monthly_salary) {
      return res.status(400).json({ error: resolvedPayType === "biweekly_fixed" ? "El sueldo quincenal es obligatorio para empleados quincenales." : "El sueldo mensual es obligatorio para empleados mensualizados." });
    }
    if (resolvedPayType === "hourly" && !hourly_rate) {
      return res.status(400).json({ error: "El valor hora es obligatorio para empleados por hora." });
    }

    try {
      const employee = await db.Employee.create({
        name, lastname, dni, cuil, address, phone, email, position, hire_date,
        hourly_rate, pay_type: pay_type || "hourly", monthly_salary, user_id, category_id, notes,
        shoe_size, shirt_size, pant_size, vacation_days_override, birth_date
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

      const { name, lastname, dni, cuil, address, phone, email, position, hire_date, termination_date, status, hourly_rate, pay_type, monthly_salary, snr_amount, user_id, category_id, notes, shoe_size, shirt_size, pant_size, vacation_days_override, birth_date } = req.body;

      // Quien no tiene employee_salaries_read no puede cambiar el sueldo: se ignora lo que
      // mande (si mandó algo) y se conserva el valor existente — mismo criterio que
      // budgetLaborService con budget_prices_read.
      const canSeeSalaries = userHasPermission(req.user, "employee_salaries_read");
      const nextHourlyRate = canSeeSalaries ? hourly_rate : undefined;
      const nextMonthlySalary = canSeeSalaries ? monthly_salary : undefined;

      // Auto-log salary changes
      const today = new Date().toISOString().split("T")[0];
      const userId = req.user?.id || null;

      if (nextHourlyRate !== undefined && Number(nextHourlyRate) !== Number(employee.hourly_rate)) {
        await db.SalaryHistory.create({
          employee_id: employee.id,
          field_changed: "hourly_rate",
          previous_value: employee.hourly_rate,
          new_value: nextHourlyRate,
          effective_date: today,
          changed_by: userId,
          notes: req.body.salary_change_notes || null,
        });
      }

      if (nextMonthlySalary !== undefined && Number(nextMonthlySalary) !== Number(employee.monthly_salary || 0)) {
        await db.SalaryHistory.create({
          employee_id: employee.id,
          field_changed: "monthly_salary",
          previous_value: employee.monthly_salary,
          new_value: nextMonthlySalary,
          effective_date: today,
          changed_by: userId,
          notes: req.body.salary_change_notes || null,
        });
      }

      await employee.update({
        name, lastname, dni, cuil, address, phone, email, position, hire_date, termination_date, status,
        hourly_rate: nextHourlyRate, pay_type, monthly_salary: nextMonthlySalary, snr_amount, user_id, category_id, notes,
        shoe_size, shirt_size, pant_size, vacation_days_override, birth_date
      });

      // Sync data to the linked User (if any)
      if (employee.user_id) {
        const linkedUser = await db.User.findByPk(employee.user_id);
        if (linkedUser) {
          await linkedUser.update({
            name: employee.name,
            lastname: employee.lastname,
            phone: employee.phone,
          });
        }
      }

      const data = canSeeSalaries ? employee : stripSalaryFields(employee.toJSON());
      return res.status(200).json({ data });
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
