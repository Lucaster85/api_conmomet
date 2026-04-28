const { verifyToken, permissions } = require("../helpers");
const db = require("../models");

exports.verifyToken = async (req, res, next) => {
  if (!req.headers.authorization)
    return res.status(401).json({ error: "No token provided" });

  const token = req.headers.authorization.replace(/^Bearer\s+/, "");

  try {
    const verify = verifyToken(token);
    const user = await db.User.findByPk(verify.id, {
      include: [
        {
          model: db.Role,
          as: "role",
          include: [{ model: db.Permission, as: "permissions" }],
        },
        { model: db.Permission, as: "permissions" },
      ],
    });
    req.user = user;
  } catch (error) {
    return res.status(500).json({ error });
  }
  next();
};

exports.authPermission = async (req, res, next) => {
  const { method, path } = req;
  const { role, permissions: userPermissions } = req.user;

  const scope = path.split("/");

  // Normalize: URL uses hyphens (time-entries) but permissions use underscores (time_entries_read)
  const resource = scope[1].replace(/-/g, "_");

  const findPermissions = permissions.find((e) => e.method === method);

  const methodPermissions = [
    ...findPermissions.permissions,
    `${resource}_${findPermissions.scope}`,
  ];

  // obtengo los permisos por role
  let getUserPermissions = role.permissions.map((e) => e.name);

  // sumo los permisos por usuario
  userPermissions.map((e) => {
    getUserPermissions.push(e.name);
  });

  let count = 0;

  for (const assignPermission of getUserPermissions) {
    for (const compare of methodPermissions) {
      if (assignPermission === compare) {
        count++;
      }
    }
  }

  if (count === 0) return res.status(401).json({ error: "Unauthoriced" });

  next();
};
