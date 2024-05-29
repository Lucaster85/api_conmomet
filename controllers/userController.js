const db = require("../models");
const permission = require("../models/permission");

module.exports = {
  getAll: async (req, res) => {
    try {
      const users = await db.User.findAll({
        include: [
          {model: db.Role, as: "role", include: [{
            model: db.Permission, as: "permissions"
          }]},
          "permissions",
        ],
      });
      return res.status(200).json({ data: users });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
  get: async (req, res) => {
    try {
      const user = await db.User.findByPk(req.params.id);
      return res.status(200).json({ data: user });
    } catch (error) {
      return res.status(500).json({ error: error });
    }
  },
  update: (req, res) => {
    return res.send("userController update");
  },
  destroy: async (req, res) => {
    try {
      const user = await db.User.findByPk(req.params.id);

      if (!user) {
        return res.status(400).json({ error: "Usuario no encontrado" });
        }
      const destroy = await user.destroy();

      return res.status(200).json({ data: destroy });
    } catch (error) {
      return res.status(500).json({ error: error });
    }
  },
};
