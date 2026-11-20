const { sendServerError } = require("../helpers/httpErrors");
const db = require("../models");
const { userHasPermission } = require("../helpers/permissions");
const { INITIAL_PERMISSIONS } = require("../helpers/seed");

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
    destroy: async (req, res) => {
        const {id} = req.params;

        try {
            const permission = await db.Permission.findByPk(id);

            if (!permission) return res.status(400).json("permiso no encontrado");

            // admin_granted y los permisos base del seed no se borran salvo que lo haga quien
            // tiene admin_granted: sin esto, permissions_delete alcanzaba para dejar la app sin admin.
            if (INITIAL_PERMISSIONS.includes(permission.name) && !userHasPermission(req.user, "admin_granted")) {
                return res.status(403).json({ error: "No podés eliminar un permiso base del sistema." });
            }

            await permission.destroy();

            return res.status(200).json("Permiso eliminado correctamente.")
        } catch (error) {
            return sendServerError(res, error);
        }

    }
}
