const db = require("../models");

module.exports = {
    getAll: async (req, res) => {
        try {
            const permissions = await db.Permission.findAll();
            return res.status(200).json(permissions);
        } catch (e) {
            res.status(400).send(e)
        }
    },
    create: async (req, res) => {
        try {
            const {name} = req.body;
            const permission = await db.Permission.create({name})
            
            return res.status(200).json(permission);
        } catch (e) {
            return res.status(400).send(e)
        }
    },
    update: (req, res) => {
        return res.send("permissionController update");
    },
    destroy: (req, res) => {
        return res.send("permissionController delete");
    }
}