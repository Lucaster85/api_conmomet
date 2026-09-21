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
        // Whitelist explícito: `key` e `is_system` nunca se aceptan del cliente, son
        // internos/inmutables. `level` sí es editable, pero acotado al nivel del actor.
        const { name, has_dashboard_access, level } = req.body;

        try {
            const actorLevel = req.user.role.level;
            const roleLevel = level !== undefined ? Number(level) : 10;

            if (!Number.isInteger(roleLevel) || roleLevel < 1 || roleLevel >= actorLevel) {
                return res.status(403).json({
                    error: `El nivel del rol debe ser un entero entre 1 y ${actorLevel - 1}.`,
                });
            }

            const key = `role_${Date.now()}`;
            const role = await db.Role.create({ name, has_dashboard_access, level: roleLevel, key });
            return res.status(200).json({ role });

        } catch (error) {
            return res.status(400).json({"error": error.message})
        }

    },
    update: async (req, res) => {
        const { id } = req.params;
        const { name, has_dashboard_access, level } = req.body;

        try {
            const role = await db.Role.findByPk(id);

            if(!role) return res.status(400).json({"error": "Role no encontrado."});

            const actorLevel = req.user.role.level;
            if (role.is_system || role.level >= actorLevel) {
                return res.status(403).json({
                    error: "No podés editar un rol protegido o de nivel igual o superior al tuyo.",
                });
            }

            if (name !== undefined) role.name = name;
            if (has_dashboard_access !== undefined) role.has_dashboard_access = has_dashboard_access;
            if (level !== undefined) {
                const newLevel = Number(level);
                if (!Number.isInteger(newLevel) || newLevel < 1 || newLevel >= actorLevel) {
                    return res.status(403).json({
                        error: `El nivel del rol debe ser un entero entre 1 y ${actorLevel - 1}.`,
                    });
                }
                role.level = newLevel;
            }
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

            if (role.is_system || role.level >= req.user.role.level) {
                return res.status(403).json({
                    error: "No podés eliminar un rol protegido o de nivel igual o superior al tuyo.",
                });
            }

            await role.destroy();

            return res.status(200).json("Role eliminado correctamente.")

        } catch (error) {
            return res.status(500).json({"error": error.message});
        }
    },

    setPermissions: async (req, res) => {
        const { id } = req.params;
        const { permissions } = req.body;

        try {
            const role = await db.Role.findByPk(id, { include: "permissions" });

            if (!role) return res.status(400).json({ error: "Role no encontrado." });

            if (role.is_system || role.level >= req.user.role.level) {
                return res.status(403).json({
                    error: "No podés modificar los permisos de un rol protegido o de nivel igual o superior al tuyo.",
                });
            }

            const permInstances = await Promise.all(
                (permissions || []).map(p => db.Permission.findByPk(p))
            );
            const validPerms = permInstances.filter(p => p !== null);

            await role.setPermissions(validPerms);

            const updated = await db.Role.findByPk(id, { include: "permissions" });
            return res.status(200).json({ data: updated });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    },
}