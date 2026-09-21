const db = require("../models");
const { Op } = require("sequelize");

module.exports = {
  // GET /lookup/roles — solo verifyToken, sin authPermission. Devuelve los roles que el
  // usuario logueado puede asignar (nivel estrictamente menor al suyo, sin roles técnicos),
  // para poblar selects sin requerir roles_read (ver UserForm.tsx).
  roles: async (req, res) => {
    try {
      const actorLevel = req.user.role.level;

      const roles = await db.Role.findAll({
        where: {
          level: { [Op.lt]: actorLevel },
          is_system: false,
        },
        attributes: ["id", "name", "level", "has_dashboard_access"],
        order: [["level", "DESC"]],
      });

      return res.status(200).json({ data: roles });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
