const db = require("../models");

module.exports = {
    getAll: async (req, res) => {
        try {
            const {count, rows} = await db.Role.findAndCountAll({include: "permissions"});
            return res.status(200).json({count, data: rows});
        } catch (error) {
            return res.status(500).json({error: error.message});
        }
    },
    get: async (req,res) => {
        const { id } = req.params;

        try {
            const role = await db.Role.findByPk(id);

            if(!role) return res.status(400).json({"error": "Role no encontrado."});

            return res.status(200).json({data: role});
        } catch (error) {
            return res.status(500).json({"error": error.message});
        }
    },
    create: async (req, res) => {
        const {name, permissions} = req.body;
        try {
            const role = await db.Role.create(req.body)
            return res.status(200).json({role});
            
        } catch (error) {
            return res.status(400).json({"error": error.message})
        }
        
    },
    update: async (req, res) => {
        const { id } = req.params;
        const { name } = req.body;

        try {
            const role = await db.Role.findByPk(id);

            if(!role) return res.status(400).json({"error": "Role no encontrado."});
            
            role.name = name;
            await role.save();

            res.status(200).json(role);
        } catch (error) {
            res.status(500).json({"error": error.message});
        }
    },
    destroy: async (req, res) => {
        const { id } = req.params;

        try {
            const role = await db.Role.findByPk(id);
            
            if(!role) return res.status(400).json({"error": "Role no encontrado."});
            
            await role.destroy();

            return res.status(200).json("Role eliminado correctamente.")

        } catch (error) {
            return res.status(500).json({"error": error.message});
        }
    }
}