const db = require("../models");

module.exports = {
    getAll: async (req, res) => {
        try {
            const { is_active } = req.query;
            const where = {};
            if (is_active !== undefined) {
                where.is_active = is_active === "true" || is_active === true;
            }
            const {count, rows} = await db.Client.findAndCountAll({ where });
            return res.status(200).json({count, data: rows});
        } catch (error) {
            return res.status(500).json({error: error.message});
        }
    },
    get: async (req,res) => {
        const { id } = req.params;

        try {
            const client = await db.Client.findByPk(id);

            if(!client) return res.status(400).json({"error": "Cliente no encontrado."});

            return res.status(200).json({data: client});
        } catch (error) {
            return res.status(500).json({"error": error.message});
        }
    },
    create: async (req, res) => {
        const {razonSocial, email, phone, is_active} = req.body;
        try {
            const client = await db.Client.create({
                razonSocial,
                email,
                phone,
                is_active: is_active !== undefined ? is_active : true,
            });
            return res.status(200).json({client});

        } catch (error) {
            return res.status(400).json({"error": error.message})
        }

    },
    // Update parcial: solo pisa los campos que vienen en el body — necesario para que
    // desactivar/activar un cliente (solo manda is_active) no borre el resto de sus datos.
    update: async (req, res) => {
        const { id } = req.params;
        const { razonSocial, email, phone, is_active } = req.body;

        try {
            const client = await db.Client.findByPk(id);

            if(!client) return res.status(400).json({"error": "Cliente no encontrado."});

            if (razonSocial !== undefined) client.razonSocial = razonSocial;
            if (email !== undefined) client.email = email;
            if (phone !== undefined) client.phone = phone;
            if (is_active !== undefined) client.is_active = is_active;
            await client.save();

            res.status(200).json(client);
        } catch (error) {
            res.status(500).json({"error": error.message});
        }
    },
}