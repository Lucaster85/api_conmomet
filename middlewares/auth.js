const { verifyToken, permissions } = require("../helpers");
const db = require("../models");

exports.verifyToken = async (req, res, next) => {
  if (!req.headers.authorization)
    return res.status(401).json({ error: "No token provided" });

  const token = req.headers.authorization.replace(/^Bearer\s+/, "");

  try {
    const verify = verifyToken(token);
    const user = await db.User.findByPk(verify.user.id, {
      include: [
        {
          model: db.Role,
          as: "role",
          include: [{ model: db.Permission, as: "permissions" }],
        },
        { model: db.Permission, as: "permissions" },
      ],
    });
    req.body.user = user;
  } catch (error) {
    return res.status(500).json({ error });
  }
  next();
};

exports.authPermission = async (req, res, next) => {
  const { method, path } = req;
  const { role, permissions: userPermissions } = req.body.user;

  const scope = path.split("/");

  const findPermissions = permissions.find((e) => e.method === method);

  const methodPermissions = [
    ...findPermissions.permissions,
    `${scope[1]}_${findPermissions.scope}`,
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
      if (assignPermission.includes(compare)) {
        count++;
      }
    }
  }

  if (count === 0) return res.status(401).json({ error: "Unauthoriced" });

  next();
};
