const { verifyToken, permissions } = require("../helpers");
const db = require("../models");

// Mapea los errores de jsonwebtoken a un code estable para que el frontend pueda discriminar
// sin depender del mensaje (que es prosa y no está garantizado). Se usa error.name porque es
// estable entre versiones; error.message se sigue mandando tal cual en "error" para no romper
// la allowlist de strings que ya usa un frontend desplegado (ver src/utils/auth.ts).
const TOKEN_ERROR_CODES = {
  TokenExpiredError: "token_expired",
  JsonWebTokenError: "token_invalid",
  NotBeforeError: "token_invalid",
};

exports.verifyToken = async (req, res, next) => {
  if (!req.headers.authorization)
    return res.status(401).json({ error: "No token provided", code: "token_missing" });

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

    if (!user) {
      return res.status(401).json({ error: "invalid token", code: "token_invalid" });
    }

    req.user = user;
  } catch (error) {
    return res.status(401).json({
      error: error.message,
      code: TOKEN_ERROR_CODES[error.name] || "token_invalid",
    });
  }
  next();
};

exports.authPermission = async (req, res, next) => {
  const { method, path } = req;
  const { role, permissions: userPermissions } = req.user;

  if (!role) return res.status(403).json({ error: "Usuario sin rol asignado.", code: "no_role" });

  const scope = path.split("/");

  // Normalize: URL uses hyphens (time-entries) but permissions use underscores (time_entries_read)
  const resource = scope[1].replace(/-/g, "_");

  const findPermissions = permissions.find((e) => e.method === method);

  if (!findPermissions) {
    return res.status(405).json({ error: "Método no permitido.", code: "method_not_allowed" });
  }

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

  if (count === 0) return res.status(401).json({ error: "Unauthoriced", code: "forbidden" });

  next();
};
