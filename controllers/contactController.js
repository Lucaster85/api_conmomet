const db = require("../models");
const { sendEmail } = require("../helpers/emailService");
const { notifyByPermission } = require("../helpers/notificationService");
const { GENERIC_OK } = require("../middlewares/publicForm");

// Motivos que ofrece el formulario. Mismo vocabulario en el ENUM de ContactInquiries y en
// ContactModal.tsx — si se suma uno, va en los tres lados.
const REASONS = {
  budget_request: "Pedido de presupuesto",
  general: "Consulta general",
  supplier: "Proveedores",
  other: "Otro",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const clean = (value, max) => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
};

// El mail quedó apagado hasta que haya servidor de mails (hoy el servicio de prueba está caído):
// se prende con CONTACT_EMAIL_ENABLED=true, sin tocar código. Si falla, solo se loguea — la consulta
// ya está guardada y es lo que cuenta, así que un mail caído nunca puede romper la respuesta.
// No se espera: el visitante no tiene por qué esperar a un servicio externo.
function sendInquiryEmail(inquiry) {
  if (process.env.CONTACT_EMAIL_ENABLED !== "true") return;
  Promise.resolve()
    .then(() =>
      sendEmail({
        templateId: process.env.EMAIL_SERVICE_TEMPLETE_ID_CONTACT_FORM,
        to: process.env.CONTACT_FORM_RECIPIENT_EMAIL,
        subject: `Nuevo mensaje de contacto de ${inquiry.name}`,
        data: {
          nombre: inquiry.name,
          empresa: inquiry.company,
          telefono: inquiry.phone,
          email: inquiry.email,
          mensaje: inquiry.message,
        },
      })
    )
    .catch((error) => console.error("[contact] no se pudo enviar el mail de la consulta:", error.message));
}

module.exports = {
  REASONS,

  // POST /public/contact — sin usuario. Pasa antes por publicRateLimit y honeypot (routes/index.js).
  // El contrato de campos (nombre, empresa, telefono, email, mensaje) no cambia; se suma `motivo`.
  sendContactForm: async (req, res) => {
    const { motivo, nombre, empresa, telefono, email, mensaje } = req.body || {};

    const reason = String(motivo || "").trim();
    if (!REASONS[reason]) {
      return res.status(400).json({ error: "Elegí el motivo de la consulta." });
    }
    const name = clean(nombre, 120);
    const message = clean(mensaje, 5000);
    if (!name || !message) {
      return res.status(400).json({ error: "El nombre y el mensaje son obligatorios." });
    }
    const emailValue = clean(email, 150);
    const phoneValue = clean(telefono, 40);
    if (!emailValue && !phoneValue) {
      return res.status(400).json({ error: "Dejanos un email o un teléfono para poder responderte." });
    }
    if (emailValue && !EMAIL_RE.test(emailValue)) {
      return res.status(400).json({ error: "El email no es válido." });
    }

    try {
      const inquiry = await db.ContactInquiry.create({
        reason,
        name,
        company: clean(empresa, 150),
        phone: phoneValue,
        email: emailValue,
        message,
        source_ip: clean(req.ip, 64),
        user_agent: clean(req.get("user-agent"), 255),
      });

      // Fire-and-forget: ni el aviso ni el mail pueden romper la respuesta, la consulta ya se guardó.
      notifyByPermission("contact_inquiries_read", {
        type: "contact_inquiry_received",
        title: "Nueva consulta web",
        body: `${inquiry.name} — ${REASONS[reason]}`,
        url: `/dashboard/contact-inquiries?view=${inquiry.id}`,
        tag: `contact-inquiry-${inquiry.id}`,
        entity: { type: "contact_inquiry", id: inquiry.id },
      });
      sendInquiryEmail(inquiry);

      // Respuesta genérica de éxito, igual que la del honeypot.
      return res.status(200).json(GENERIC_OK);
    } catch (error) {
      console.error("[contact] no se pudo guardar la consulta:", error.message);
      return res.status(500).json({ error: "No pudimos enviar tu mensaje. Probá de nuevo en unos minutos." });
    }
  },
};
