const { sendEmail } = require("../helpers/emailService");

module.exports = {
    sendContactForm: async (req, res) => {
        const { nombre, empresa, telefono, email, mensaje } = req.body;

        if (!nombre || !email || !mensaje) {
            return res.status(400).json({ error: "nombre, email y mensaje son requeridos." });
        }

        try {
            await sendEmail({
                templateId: process.env.EMAIL_SERVICE_TEMPLETE_ID_CONTACT_FORM,
                to: process.env.CONTACT_FORM_RECIPIENT_EMAIL,
                subject: `Nuevo mensaje de contacto de ${nombre}`,
                data: { nombre, empresa, telefono, email, mensaje },
            });

            return res.status(200).json({ message: "Mensaje enviado correctamente." });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    },
};
