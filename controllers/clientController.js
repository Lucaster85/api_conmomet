const db = require("../models");

module.exports = {
    getAll: async (req, res) => {
        try {
            const {count, rows} = await db.Client.findAndCountAll();
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
        const {razonSocial, email, phone} = req.body;
        try {
            const client = await db.Client.create({razonSocial, email, phone});
            return res.status(200).json({client});
            
        } catch (error) {
            return res.status(400).json({"error": error.message})
        }
        
    },
    update: async (req, res) => {
        const { id } = req.params;
        const { razonSocial, email, phone } = req.body;

        try {
            const client = await db.Client.findByPk(id);

            if(!client) return res.status(400).json({"error": "Cliente no encontrado."});
            
            client.razonSocial = razonSocial
            client.email = email
            client.phone = phone;
            await client.save();

            res.status(200).json(client);
        } catch (error) {
            res.status(500).json({"error": error.message});
        }
    },
    destroy: async (req, res) => {
        const { id } = req.params;

        try {
            const client = await db.Client.findByPk(id);
            
            if(!client) return res.status(400).json({"error": "Cliente no encontrado."});
            
            await client.destroy();
            return res.status(200).json("Cliente eliminado correctamente.")

        } catch (error) {
            return res.status(500).json({"error": error.message});
        }
    }
}