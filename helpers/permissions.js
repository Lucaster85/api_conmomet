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