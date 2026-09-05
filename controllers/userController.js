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
    // La contraseña ya no se toca desde acá: cada usuario la cambia desde "Cambiar contraseña"
    // (PUT /me/password) o, si es nueva, la recibe generada al crearla.
    const { name, lastname, role_id, cuit, phone, celphone, employee_id, email } = req.body;

    try {
      const user = await db.User.findByPk(id);

      if(!user) return res.status(400).json({error: "Usuario no encontrado."});

      // Validamos ANTES de tocar nada: un rol sin acceso al dashboard (ej. "Operario") solo
      // tiene sentido vinculado a un empleado — si no, el usuario no puede entrar ni a
      // /dashboard (sin permisos) ni a /portal (sin employee_id).
      const effectiveRoleId = (role_id !== null && role_id !== undefined) ? role_id : user.role_id;
      const effectiveRole = await db.Role.findByPk(effectiveRoleId);
      if (!effectiveRole) return res.status(400).json({ error: "Rol inválido." });

      if (effectiveRole.has_dashboard_access === false) {
        const willHaveEmployee = employee_id !== undefined
          ? !!employee_id
          : !!(await db.Employee.findOne({ where: { user_id: user.id }, attributes: ['id'] }));
        if (!willHaveEmployee) {
          return res.status(400).json({
            error: "Los roles sin acceso al dashboard deben estar vinculados a un empleado.",
          });
        }
      }

      if(name !== null && name !== undefined) user.name = name;
      if(lastname !== null && lastname !== undefined) user.lastname = lastname;
      if(role_id !== null && role_id !== undefined) user.role_id = role_id;
      if(cuit !== null && cuit !== undefined) user.cuit = cuit;
      if(email !== null && email !== undefined) user.email = email;

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
        if (field === 'email') {
          return res.status(400).json({ error: "El email ingresado ya se encuentra registrado." });
        }
        return res.status(400).json({ error: `El valor ingresado para "${field}" ya existe en el sistema.` });
      }
      return res.status(500).json({error: error.message});
    }
  },
  // PUT /me/password — el propio usuario logueado cambia su contraseña (requiere la actual)
  changeMyPassword: async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "La contraseña actual y la nueva son obligatorias." });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "La nueva contraseña debe tener al menos 8 caracteres." });
    }

    try {
      const { verifyPass, encryptPass } = require("../helpers");
      const user = await db.User.findByPk(req.user.id);
      if (!user) return res.status(404).json({ error: "Usuario no encontrado." });

      const valid = await verifyPass(currentPassword, user.password);
      if (!valid) return res.status(401).json({ error: "La contraseña actual es incorrecta." });

      user.password = await encryptPass(newPassword);
      user.must_change_password = false;
      await user.save();

      return res.status(200).json({ data: { success: true } });
    } catch (error) {
      return res.status(500).json({ error: error.message });
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
