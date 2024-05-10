const db = require("../models");
const permission = require("../models/permission");

module.exports = {
  getAll: async (req, res) => {
    try {
      const users = await db.User.findAll({
        include: [
          {model: db.Role, as: "role", include: {
            model: db.Permission, as: "permissions"
          }},
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
  destroy: (req, res) => {
    return res.send("userController delete");
  },
};
