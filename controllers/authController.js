const crypto = require("crypto");
const db = require("../models");
const { encryptPass, createToken, verifyPass } = require("../helpers");
const permission = require("../models/permission");

module.exports = {
  create: async (req, res) => {
    let {
      name,
      lastname,
      email,
      password,
      role_id,
      cuit,
      phone,
      celphone,
      permissions,
      employee_id,
    } = req.body;

    if (!name || !lastname || !email || !cuit) {
      return res.status(400).json({ error: "Faltan datos obligatorios" });
    }

    // Administración ya no tipea la contraseña de otra persona: si no viene una (caso normal
    // desde el modal de Usuarios), se genera una aleatoria acá y se devuelve una única vez en
    // la respuesta para que se la copien y se la pasen a la persona.
    const generatedPassword = password ? null : crypto.randomBytes(8).toString("hex");

    try {
      if (!role_id) {
        const defaultRole = await db.Role.findOne({ where: { name: "user" } });
        role_id = defaultRole.id;
      }

      const role = await db.Role.findByPk(role_id);
      if (!role) return res.status(400).json({ error: "Rol inválido." });

      // Resolvemos el empleado a linkear (si vino) ANTES de crear el User, para no dejar
      // usuarios huérfanos si el link falla.
      let employee = null;
      if (employee_id) {
        employee = await db.Employee.findByPk(employee_id);
        if (!employee) return res.status(400).json({ error: "Empleado no encontrado." });
        if (employee.user_id) return res.status(400).json({ error: "Ese empleado ya tiene un usuario vinculado." });
      }

      // Un rol sin acceso al dashboard (ej. "Operario") solo tiene sentido vinculado a un
      // empleado — si no, el usuario no puede entrar a /dashboard (no tiene permisos) NI a
      // /portal (no tiene employee_id), y queda en un estado sin salida.
      if (role.has_dashboard_access === false && !employee) {
        return res.status(400).json({
          error: "Los roles sin acceso al dashboard deben vincularse a un empleado al crear el usuario.",
        });
      }

      const hashPass = await encryptPass(password || generatedPassword);
      const user = await db.User.create({
        name,
        lastname,
        email,
        password: hashPass,
        role_id,
        cuit,
        phone,
        celphone,
        must_change_password: !!generatedPassword,
      });

      const token = createToken(user);

      if (employee) {
        await employee.update({ user_id: user.id });
      }

      return res.status(201).json({ data: user, token, generatedPassword });
    } catch (error) {
      // Handle unique constraint violations
      if (error.name === 'SequelizeUniqueConstraintError') {
        const field = error.errors?.[0]?.path;
        if (field === 'email') {
          return res.status(400).json({ error: "El email ingresado ya se encuentra registrado." });
        }
        if (field === 'cuit') {
          return res.status(400).json({ error: "El CUIT ingresado ya se encuentra registrado." });
        }
        return res.status(400).json({ error: `El valor ingresado para "${field}" ya existe en el sistema.` });
      }
      return res.status(500).json({ error: error.message });
    }
  },
  login: async (req, res) => {
    try {
      const { email, password } = req.body;

      // Validar que se proporcionen email y password
      if (!email || !password) {
        return res.status(400).json({ 
          error: "Email y contraseña son requeridos" 
        });
      }

      const user = await db.User.findOne({
        where: {
          email: email,
        },
        include: [
          {
            model: db.Role,
            as: "role",
            include: "permissions",
          },
          "permissions",
        ],
      });

      // Verificar si el usuario existe
      if (!user) {
        return res
          .status(401)
          .json({ error: "Email o contraseña incorrectos" });
      }

      const verify = await verifyPass(password, user.password);

      if (!verify) {
        return res
          .status(401)
          .json({ error: "Email o contraseña incorrectos" });
      }

      const token = createToken(user);
      
      // Buscar si el usuario tiene un legajo de empleado vinculado
      const linkedEmployee = await db.Employee.findOne({
        where: { user_id: user.id },
        attributes: ['id']
      });

      const enrichedUser = {
        ...user.toJSON(),
        employee_id: linkedEmployee ? linkedEmployee.id : null,
        has_dashboard_access: user.role && user.role.has_dashboard_access !== undefined ? user.role.has_dashboard_access : true
      };

      // res.setHeader('Set-Cookie', token)
      return res.status(200).json({ user: enrichedUser, token });
    } catch (error) {
      console.error('Error en login:', error);
      return res.status(500).json({ 
        error: "Error interno del servidor",
        details: error.message 
      });
    }
  },
};
