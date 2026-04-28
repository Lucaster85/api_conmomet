const db = require("../models");
const permission = require("../models/permission");

module.exports = {
  getAll: async (req, res) => {
    try {
      const { rows, count } = await db.User.findAndCountAll({
        include: [
          { model: db.Role, as: "role", include: "permissions" },
          "permissions",
        ]
      });
      return res.status(200).json({ count, data: rows });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
  get: async (req, res) => {
    try {
      const user = await db.User.findByPk(req.params.id);
      return res.status(200).json({ data: user });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
  update: async (req, res) => {
    const { id } = req.params;
    const { name, lastname, role_id, cuit, phone, celphone, employee_id } = req.body;

    try {
      const user = await db.User.findByPk(id);

      if(!user) return res.status(400).json({error: "Usuario no encontrado."});

      if(name !== null) user.name = name;
      if(lastname !== null) user.lastname = lastname;
      if(role_id !== null) user.role_id = role_id;
      if(cuit !== null) user.cuit = cuit;

      if(phone !== undefined) user.phone = phone;
      if(celphone !== undefined) user.celphone = celphone;

      await user.save();

      // Handle employee linking change
      if (employee_id !== undefined) {
        // Unlink previous employee if existed
        await db.Employee.update({ user_id: null }, { where: { user_id: user.id } });
        // Link new employee if provided
        if (employee_id) {
          await db.Employee.update({ user_id: user.id }, { where: { id: employee_id } });
        }
      }

      // Sync data to the currently linked employee (if any)
      const linkedEmployee = await db.Employee.findOne({ where: { user_id: user.id } });
      if (linkedEmployee) {
        await linkedEmployee.update({
          name: user.name,
          lastname: user.lastname,
          phone: user.phone,
        });
      }

      return res.status(200).json(user);
    } catch (error) {
      if (error.name === 'SequelizeUniqueConstraintError') {
        const field = error.errors?.[0]?.path;
        if (field === 'cuit') {
          return res.status(400).json({ error: "El CUIT ingresado ya se encuentra registrado." });
        }
        return res.status(400).json({ error: `El valor ingresado para "${field}" ya existe en el sistema.` });
      }
      return res.status(500).json({error: error.message});
    }
  },
  destroy: async (req, res) => {
    try {
      const user = await db.User.findByPk(req.params.id);

      if (!user) {
        return res.status(400).json({ error: "Usuario no encontrado" });
      }
      const destroy = await user.destroy();

      return res.status(200).json({ data: destroy });
    } catch (error) {
      return res.status(500).json({ error: error });
    }
  },
};
