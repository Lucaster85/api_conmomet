const crypto = require("crypto");
const db = require("../models");
const { encryptPass, createToken } = require("../helpers");
const { sendEmail } = require("../helpers/emailService");

const INVITATION_EXPIRATION_DAYS = 7;
const OPERARIO_ROLE_NAME = "Operario";

// Bypass para pruebas locales: en vez de mandar el mail/WhatsApp al contacto real del empleado,
// lo manda siempre a un destino de prueba fijo. Se activa a propósito con una env var explícita
// (nunca por NODE_ENV solo) para que no quede prendido sin querer en producción.
// El Employee igual se actualiza con el contacto real que cargó administración — el bypass solo
// afecta A DÓNDE se manda el mensaje, no qué se guarda.
const TEST_MODE = process.env.TEST_NOTIFICATIONS_ENABLED === "true";

const hashToken = (rawToken) => crypto.createHash("sha256").update(rawToken).digest("hex");

const getInvitationStatus = (invitation) => {
  if (invitation.accepted_at) return "accepted";
  if (new Date(invitation.expires_at) < new Date()) return "expired";
  return "pending";
};

module.exports = {
  // POST /employees/:id/invite (admin)
  create: async (req, res) => {
    try {
      const { channel, contact } = req.body;
      if (!["email", "whatsapp"].includes(channel)) {
        return res.status(400).json({ error: "El canal debe ser 'email' o 'whatsapp'." });
      }
      if (!contact || !contact.trim()) {
        return res.status(400).json({ error: "El destino de la invitación es obligatorio." });
      }

      const employee = await db.Employee.findByPk(req.params.id);
      if (!employee) return res.status(404).json({ error: "Empleado no encontrado." });
      if (employee.user_id) return res.status(400).json({ error: "El empleado ya tiene un usuario vinculado." });

      const contactValue = contact.trim();

      if (channel === "email") {
        const existingUser = await db.User.findOne({ where: { email: contactValue } });
        if (existingUser) {
          return res.status(409).json({ error: "Ya existe un usuario con ese email. Vinculalo manualmente en vez de invitar." });
        }
        if (employee.email !== contactValue) {
          await employee.update({ email: contactValue });
        }
      } else if (employee.phone !== contactValue) {
        await employee.update({ phone: contactValue });
      }

      // Invalida (soft-delete) cualquier invitación previa no aceptada de este empleado.
      await db.EmployeeInvitation.destroy({ where: { employee_id: employee.id, accepted_at: null } });

      const rawToken = crypto.randomBytes(32).toString("hex");
      const expires_at = new Date(Date.now() + INVITATION_EXPIRATION_DAYS * 24 * 60 * 60 * 1000);

      const invitation = await db.EmployeeInvitation.create({
        employee_id: employee.id,
        token_hash: hashToken(rawToken),
        channel,
        expires_at,
        created_by: req.user.id,
      });

      const inviteLink = `${process.env.FRONTEND_URL}/invite/${rawToken}`;

      // En modo prueba, el envío real (mail o WhatsApp) va siempre al destino de prueba, sin
      // importar el contacto real del empleado. `contact_used` es lo que efectivamente recibe
      // el mensaje, para que el frontend lo muestre con claridad.
      const contactUsed = TEST_MODE
        ? (channel === "email" ? process.env.TEST_NOTIFICATIONS_EMAIL : process.env.TEST_NOTIFICATIONS_PHONE)
        : contactValue;

      let email_sent = false;
      if (channel === "email") {
        try {
          await sendEmail({
            templateId: process.env.EMAIL_SERVICE_TEMPLATE_ID_INVITATION,
            to: contactUsed,
            subject: "Invitación al Portal Conmomet",
            data: { link: inviteLink, employeeName: employee.name },
          });
          email_sent = true;
        } catch (emailError) {
          console.error("[employeeInvitation] Error enviando email:", emailError.message);
          // No cortamos el flujo: administración puede compartir el link manualmente.
        }
      }

      return res.status(201).json({
        data: {
          invitation: { id: invitation.id, expires_at: invitation.expires_at, channel: invitation.channel },
          invite_link: inviteLink,
          email_sent,
          test_mode: TEST_MODE,
          contact_used: contactUsed,
          // Para el botón secundario "Compartir por WhatsApp", que existe sin importar el canal
          // elegido — en modo prueba también debe apuntar al teléfono de prueba, nunca al real.
          whatsapp_contact: TEST_MODE ? process.env.TEST_NOTIFICATIONS_PHONE : employee.phone,
        },
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // GET /employees/:id/invitation (admin)
  getStatus: async (req, res) => {
    try {
      const invitation = await db.EmployeeInvitation.findOne({
        where: { employee_id: req.params.id, accepted_at: null },
        order: [["createdAt", "DESC"]],
      });
      if (!invitation) return res.status(200).json({ data: null });

      return res.status(200).json({
        data: {
          id: invitation.id,
          status: getInvitationStatus(invitation),
          channel: invitation.channel,
          expires_at: invitation.expires_at,
          createdAt: invitation.createdAt,
        },
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // GET /public/invitations/:token (público)
  validateToken: async (req, res) => {
    try {
      const invitation = await db.EmployeeInvitation.findOne({
        where: { token_hash: hashToken(req.params.token) },
        include: [{ model: db.Employee, as: "employee", attributes: ["id", "name", "lastname"] }],
      });
      if (!invitation) return res.status(404).json({ error: "Invitación no encontrada." });
      if (invitation.accepted_at) return res.status(410).json({ error: "Esta invitación ya fue utilizada." });
      if (new Date(invitation.expires_at) < new Date()) {
        return res.status(410).json({ error: "La invitación expiró. Pedile a administración que te envíe una nueva." });
      }

      return res.status(200).json({
        data: {
          employeeName: invitation.employee.name,
          employeeLastname: invitation.employee.lastname,
        },
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // POST /public/invitations/:token/accept (público)
  accept: async (req, res) => {
    try {
      const { password } = req.body;
      if (!password || password.length < 8) {
        return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres." });
      }

      const invitation = await db.EmployeeInvitation.findOne({ where: { token_hash: hashToken(req.params.token) } });
      if (!invitation) return res.status(404).json({ error: "Invitación no encontrada." });
      if (invitation.accepted_at) return res.status(410).json({ error: "Esta invitación ya fue utilizada." });
      if (new Date(invitation.expires_at) < new Date()) {
        return res.status(410).json({ error: "La invitación expiró." });
      }

      const employee = await db.Employee.findByPk(invitation.employee_id);
      if (!employee) return res.status(404).json({ error: "Empleado no encontrado." });
      if (employee.user_id) return res.status(409).json({ error: "El empleado ya tiene un usuario vinculado." });

      const operarioRole = await db.Role.findOne({ where: { name: OPERARIO_ROLE_NAME } });
      if (!operarioRole) return res.status(500).json({ error: "No se encontró el rol Operario. Contactá a administración." });

      const hashPass = await encryptPass(password);
      const newUser = await db.User.create({
        name: employee.name,
        lastname: employee.lastname,
        email: employee.email,
        password: hashPass,
        role_id: operarioRole.id,
        cuit: (employee.cuil || "").replace(/\D/g, "").slice(0, 11),
        phone: employee.phone,
      });

      await employee.update({ user_id: newUser.id });
      await invitation.update({ accepted_at: new Date() });

      // Volvemos a buscar el user con el mismo include que usa authController.login para que la
      // respuesta tenga la misma forma que POST /auth/login y el frontend pueda reusar la misma
      // lógica de armado de "cleanUser" (buildCleanUser) para loguear automáticamente.
      const user = await db.User.findByPk(newUser.id, {
        include: [
          { model: db.Role, as: "role", include: "permissions" },
          "permissions",
        ],
      });

      const token = createToken(user);
      const enrichedUser = {
        ...user.toJSON(),
        employee_id: employee.id,
        has_dashboard_access: user.role && user.role.has_dashboard_access !== undefined ? user.role.has_dashboard_access : true,
      };

      return res.status(201).json({ user: enrichedUser, token });
    } catch (error) {
      if (error.name === "SequelizeUniqueConstraintError") {
        return res.status(409).json({ error: "Ya existe un usuario con ese email o CUIT. Contactá a administración." });
      }
      return res.status(500).json({ error: error.message });
    }
  },
};
