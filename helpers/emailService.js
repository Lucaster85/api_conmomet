// Error propio (no `Error` plano): lleva la respuesta del proveedor de mail, que no debe llegar al cliente.
// sendServerError (helpers/httpErrors.js) enmascara todo lo que no sea un Error plano; el detalle queda en el log.
class EmailServiceError extends Error {
    constructor(message) {
        super(message);
        this.name = "EmailServiceError";
    }
}

const sendEmail = async ({ templateId, to, subject, data }) => {
    const response = await fetch(process.env.EMAIL_SERVICE_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.EMAIL_SERVICE_TOKEN}`,
        },
        body: JSON.stringify({ templateId, to, subject, data }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new EmailServiceError(`Email service error ${response.status}: ${errorText}`);
    }

    return response.json();
};

module.exports = { sendEmail, EmailServiceError };
