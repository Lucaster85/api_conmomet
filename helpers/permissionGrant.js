// Regla "no se otorga lo que no se tiene" (FLOWS.md §75.1): quien edita los permisos de un rol
// solo puede AGREGAR permisos que él mismo tiene. Quitar se permite siempre. Quien tiene
// admin_granted puede todo (userHasPermission ya lo trata como comodín).
const db = require("../models");
const { userHasPermission } = require("./permissions");

/**
 * Devuelve los nombres de los permisos que se agregan (están en newIds y no en currentIds) y
 * que el actor no tiene. Lista vacía si el actor tiene admin_granted o no agrega nada.
 * `actor` es req.user (con role.permissions y permissions cargados).
 */
exports.findUngrantablePermissions = async (actor, currentIds = [], newIds = []) => {
  if (userHasPermission(actor, "admin_granted")) return [];

  const current = new Set((currentIds || []).map(Number));
  const added = [...new Set((newIds || []).map(Number))].filter((id) => !current.has(id));
  if (added.length === 0) return [];

  const rows = await db.Permission.findAll({ where: { id: added }, attributes: ["id", "name"] });
  return rows.map((p) => p.name).filter((name) => !userHasPermission(actor, name));
};
