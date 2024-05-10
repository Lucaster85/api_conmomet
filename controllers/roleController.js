const db = require("../models");

module.exports = {
    getAll: async (req, res) => {
        try {
            const roles = await db.Role.findAll();

            return res.status(200).json({roles});
        } catch (error) {
            return res.status(500).json({error: error.message});
        }
    },
    create: (req, res) => {
        const {name, permissions} = req.body;
        db.Role.create(req.body).then(role => {
            return res.status(200).json({role});
        }).catch(e => res.status(400).json(e.message))
    },
    update: (req, res) => {
        return res.send("roleController update");
    },
    destroy: (req, res) => {
        return res.send("roleController delete");
    }
}