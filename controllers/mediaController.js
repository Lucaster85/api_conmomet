const db = require("../models");

module.exports = {
    getByType: async (req, res) => {
        const { type } = req.params;

        try {
            const medias = await db.Media.findAll({ where: { type } });
            return res.status(200).json(medias);
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    },
    upload: async (req, res) => {
        const { type, title, description, order } = req.body;
        const file = req.file;

        if (!file) {
            return res.status(400).json({ error: "No file uploaded" });
        }

        try {
            const media = await db.Media.create({
                title,
                description,
                type,
                order,
                url: `/uploads/${type}/${file.filename}`,
            });

            return res.status(200).json(media);
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    },
};