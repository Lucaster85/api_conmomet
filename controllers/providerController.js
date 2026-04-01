const db = require("../models");

module.exports = {
    getAll: async (req, res) => {
        try {
            const {count, rows} = await db.Provider.findAndCountAll();
            return res.status(200).json({count, data: rows});
        } catch (error) {
            return res.status(500).json({error: error.message});
        }
    },
    get: async (req,res) => {
        const { id } = req.params;

        try {
            const provider = await db.Provider.findByPk(id);

            if(!provider) return res.status(400).json({"error": "Proveedor no encontrado."});

            return res.status(200).json({data: provider});
        } catch (error) {
            return res.status(500).json({"error": error.message});
        }
    },
    create: async (req, res) => {
        const {razonSocial, email, phone} = req.body;
        try {
            const provider = await db.Provider.create({razonSocial, email, phone});
            return res.status(200).json({provider});
            
        } catch (error) {
            return res.status(400).json({"error": error.message})
        }
        
    },
    update: async (req, res) => {
        const { id } = req.params;
        const { razonSocial, email, phone } = req.body;

        try {
            const provider = await db.Provider.findByPk(id);

            if(!provider) return res.status(400).json({"error": "Proveedor no encontrado."});
            
            provider.razonSocial = razonSocial
            provider.email = email
            provider.phone = phone;
            await provider.save();

            res.status(200).json(provider);
        } catch (error) {
            res.status(500).json({"error": error.message});
        }
    },
    destroy: async (req, res) => {
        const { id } = req.params;

        try {
            const provider = await db.Provider.findByPk(id);
            
            if(!provider) return res.status(400).json({"error": "Proveedor no encontrado."});
            
            await provider.destroy();
            return res.status(200).json("Proveedor eliminado correctamente.")

        } catch (error) {
            return res.status(500).json({"error": error.message});
        }
    }
}