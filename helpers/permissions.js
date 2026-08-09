// Chequeo de permiso individual, usado por controllers para gatear campos/secciones dentro
// de una respuesta (distinto del middleware authPermission, que gatea la ruta entera).
exports.userHasPermission = (user, permissionName) => {
    const rolePerms = (user.role && user.role.permissions) ? user.role.permissions.map((p) => p.name) : [];
    const userPerms = user.permissions ? user.permissions.map((p) => p.name) : [];
    const all = [...rolePerms, ...userPerms];
    return all.includes("admin_granted") || all.includes(permissionName);
};

exports.permissions = [
    {
        method: "GET",
        scope: "read",
        permissions: ["admin_granted"]
    },
    {
        method: "POST",
        scope: "write",
        permissions: ["admin_granted"]
    },
    {
        method: "PUT",
        scope: "update",
        permissions: ["admin_granted"]
    },
    {
        method: "DELETE",
        scope: "delete",
        permissions: ["admin_granted"]
    }
]