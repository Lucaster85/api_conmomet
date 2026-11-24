const { sendServerError } = require("../helpers/httpErrors");
const db = require("../models");
const { findUngrantablePermissions } = require("../helpers/permissionGrant");

module.exports = {
    getAll: async (req, res) => {
        try {
            const {count, rows} = await db.Role.findAndCountAll({include: "permissions"});
            return res.status(200).json({count, data: rows});
        } catch (error) {
            return sendServerError(res, error);
        }
    },
    get: async (req,res) => {
        const { id } = req.params;

        try {
            const role = await db.Role.findByPk(id);

            if(!role) return res.status(400).json({"error": "Role no encontrado."});

            return res.status(200).json({data: role});
        } catch (error) {
            return sendServerError(res, error);
        }
    },
    create: async (req, res) => {
        // Whitelist explícito: `key` e `is_system` nunca se aceptan del cliente, son
        // internos/inmutables. `level` sí es editable, pero acotado al nivel del actor.
        const { name, has_dashboard_access, level } = req.body;

        try {
            const actorLevel = req.user.role.level;
            const roleLevel = level !== undefined ? Number(level) : 10;

            if (!Number.isInteger(roleLevel) || roleLevel < 1 || roleLevel > actorLevel) {
                return res.status(403).json({
                    error: `El nivel del rol debe ser un entero entre 1 y ${actorLevel}.`,
                });
            }

            const key = `role_${Date.now()}`;
            const role = await db.Role.create({ name, has_dashboard_access, level: roleLevel, key });
            return res.status(200).json({ role });

        } catch (error) {
            return res.status(400).json({"error": error.message})
        }

    },
    // POST /roles/:id/duplicate — crea un rol nuevo con los mismos permisos que otro (FLOWS.md §84). Es crear + copiar
    // permisos en UNA transacción: si algo falla no queda un rol vacío a medio armar. Reglas, las mismas que ya valen por
    // separado: nivel acotado al del actor (create), no se toca un rol de nivel superior (update/setPermissions) y no se
    // otorga lo que no se tiene (setPermissions). Llega con roles_write por authPermission, y roles_update se exige en la ruta
    // porque copiar permisos es asignarlos.
    duplicate: async (req, res) => {
        const { id } = req.params;
        const { name, has_dashboard_access, level } = req.body;

        try {
            const source = await db.Role.findByPk(id, { include: "permissions" });
            if (!source) return res.status(404).json({ error: "Role no encontrado." });

            const actorLevel = req.user.role.level;
            if (source.level > actorLevel) {
                return res.status(403).json({ error: "No podés duplicar un rol de nivel superior al tuyo." });
            }

            const cleanName = typeof name === "string" ? name.trim() : "";
            if (!cleanName || cleanName.length > 50) {
                return res.status(400).json({ error: "El nombre del rol es obligatorio y puede tener hasta 50 caracteres." });
            }

            // Por defecto el duplicado hereda nivel y acceso al dashboard del original; ambos se pueden cambiar al duplicar.
            const roleLevel = level !== undefined ? Number(level) : source.level;
            if (!Number.isInteger(roleLevel) || roleLevel < 1 || roleLevel > actorLevel) {
                return res.status(403).json({ error: `El nivel del rol debe ser un entero entre 1 y ${actorLevel}.` });
            }
            if (has_dashboard_access !== undefined && typeof has_dashboard_access !== "boolean") {
                return res.status(400).json({ error: "has_dashboard_access debe ser verdadero o falso." });
            }

            const ungrantable = await findUngrantablePermissions(req.user, [], source.permissions.map((p) => p.id));
            if (ungrantable.length > 0) {
                return res.status(403).json({
                    error: `No podés duplicar este rol: incluye permisos que no tenés (${ungrantable.join(", ")}).`,
                });
            }

            // `key` e `is_system` no se heredan: la copia nunca es un rol de sistema.
            const created = await db.sequelize.transaction(async (transaction) => {
                const role = await db.Role.create({
                    name: cleanName,
                    has_dashboard_access: has_dashboard_access !== undefined ? has_dashboard_access : source.has_dashboard_access,
                    level: roleLevel,
                    key: `role_${Date.now()}`,
                }, { transaction });
                await role.setPermissions(source.permissions, { transaction });
                return role;
            });

            const full = await db.Role.findByPk(created.id, { include: "permissions" });
            return res.status(201).json({ data: full });
        } catch (error) {
            return sendServerError(res, error);
        }
    },
    update: async (req, res) => {
        const { id } = req.params;
        const { name, has_dashboard_access, level } = req.body;

        try {
            const role = await db.Role.findByPk(id);

            if(!role) return res.status(400).json({"error": "Role no encontrado."});

            const actorLevel = req.user.role.level;
            if (role.is_system || role.level > actorLevel) {
                return res.status(403).json({
                    error: "No podés editar un rol protegido o de nivel superior al tuyo.",
                });
            }

            if (name !== undefined) role.name = name;
            if (has_dashboard_access !== undefined) role.has_dashboard_access = has_dashboard_access;
            if (level !== undefined) {
                const newLevel = Number(level);
                if (!Number.isInteger(newLevel) || newLevel < 1 || newLevel > actorLevel) {
                    return res.status(403).json({
                        error: `El nivel del rol debe ser un entero entre 1 y ${actorLevel}.`,
                    });
                }
                role.level = newLevel;
            }
            await role.save();

            res.status(200).json(role);
        } catch (error) {
            sendServerError(res, error);
        }
    },
    destroy: async (req, res) => {
        const { id } = req.params;

        try {
            const role = await db.Role.findByPk(id);

            if(!role) return res.status(400).json({"error": "Role no encontrado."});

            if (role.is_system || role.level > req.user.role.level) {
                return res.status(403).json({
                    error: "No podés eliminar un rol protegido o de nivel superior al tuyo.",
                });
            }

            await role.destroy();

            return res.status(200).json("Role eliminado correctamente.")

        } catch (error) {
            return sendServerError(res, error);
        }
    },

    setPermissions: async (req, res) => {
        const { id } = req.params;
        const { permissions } = req.body;

        try {
            const role = await db.Role.findByPk(id, { include: "permissions" });

            if (!role) return res.status(400).json({ error: "Role no encontrado." });

            if (role.is_system || role.level > req.user.role.level) {
                return res.status(403).json({
                    error: "No podés modificar los permisos de un rol protegido o de nivel superior al tuyo.",
                });
            }

            const permInstances = await Promise.all(
                (permissions || []).map(p => db.Permission.findByPk(p))
            );
            const validPerms = permInstances.filter(p => p !== null);

            // No se otorga lo que no se tiene: sin esto, con roles_update alcanzaba para
            // sumarle admin_granted al rol propio (de igual nivel y no de sistema).
            const ungrantable = await findUngrantablePermissions(
                req.user,
                role.permissions.map(p => p.id),
                validPerms.map(p => p.id),
            );
            if (ungrantable.length > 0) {
                return res.status(403).json({
                    error: `No podés otorgar permisos que no tenés: ${ungrantable.join(", ")}.`,
                });
            }

            await role.setPermissions(validPerms);

            const updated = await db.Role.findByPk(id, { include: "permissions" });
            return res.status(200).json({ data: updated });
        } catch (error) {
            return sendServerError(res, error);
        }
    },
}