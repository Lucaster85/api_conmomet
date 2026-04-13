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
        throw new Error(`Email service error ${response.status}: ${errorText}`);
    }

    return response.json();
};

module.exports = { sendEmail };
