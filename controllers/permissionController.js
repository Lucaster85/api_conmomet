const db = require("../models");

module.exports = {
    getAll: async (req, res) => {
        try {
            const {count, rows} = await db.Permission.findAndCountAll();
            return res.status(200).json({count, data: rows});
        } catch (e) {
            res.status(400).json({"error": e.message});
        }
    },
    get: async (req, res) => {
        const id = req.params.id;

        try {
            const permission = await db.Permission.findByPk(id);
            return res.status(200).json(permission);
        } catch (e) {
            res.status(400).json({"error": e.message});
        }
    },
    create: async (req, res) => {
        const {permissions: arrayPerm} = req.body;

        if (!Array.isArray(arrayPerm) || arrayPerm.length === 0) {
            return res.status(500).json({"error": "Debe proveer un array de permisos"});
        }

        try {
            const permission = await db.Permission.bulkCreate(arrayPerm);
            
            return res.status(200).json(permission);
        } catch (e) {
            return res.status(400).json({"error": e.message});
        }
    },
    update: async (req, res) => {
        const id = req.params.id;
        const {name} = req.body;
        try {
            const permission = await db.Permission.findByPk(id);
            
            permission.name = name;

            await permission.save();

            return res.status(200).json(permission);
        } catch (error) {
            return res.status(500).json({"error": error.message})
        }
    },
    destroy: async (req, res) => {
        const {id} = req.params;

        try {
            const permission = await db.Permission.findByPk(id);

            if (!permission) return res.status(400).json("permiso no encontrado");

            permission.destroy();

            return res.status(200).json("Permiso eliminado correctamente.")
        } catch (error) {
            return res.status(500).json({"error": error.message});
        }

    },
    assign: async (req, res) => {
        const {permissions, type, id} = req.body;
        
        let result = null;
        try {
            if (type === "role") {
                result = await db.Role.findByPk(id);

                if(!result) return res.status(400).json({"error": "Role no encontrado"});
                await Promise.all(permissions.map(async p => {
                    const rolePermission = await db.Permission.findByPk(p);
                    result.addPermission(rolePermission);
                }));
            } else if (type === "user") {
                result = await db.User.findByPk(id);

                if(!result) return res.status(400).json({"error": "Usuario no encontrado"});
                await Promise.all(permissions.map(async p => {
                    const userPermission = await db.Permission.findByPk(p);
                    result.addPermission(userPermission);
                }));
            } else {
                return res.status(400).json({"error": "Debe asignar permisos a un role o un usario"});
            }
            return res.status(200).json(result);
        } catch (error) {
            return res.status(500).json({"error": error.message});
        }
    }
}