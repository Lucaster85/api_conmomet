const db = require("../models");
const permission = require("../models/permission");

module.exports = {
  getAll: async (req, res) => {
    try {
      const { rows, count } = await db.User.findAndCountAll({
        include: [
          { model: db.Role, as: "role", include: "permissions" },
          "permissions",
        ]
      });
      return res.status(200).json({ count, data: rows });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
  get: async (req, res) => {
    try {
      const user = await db.User.findByPk(req.params.id);
      return res.status(200).json({ data: user });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
  update: async (req, res) => {
    const { id } = req.params;
    const { name, lastname, role_id, cuit } = req.body;

    try {
      const user = await db.User.findByPk(id);

      if(!user) return res.status(400).json({error: "Usuario no encontrado."});

      if(name !== null) user.name = name;
      if(lastname !== null) user.lastname = lastname;
      if(role_id !== null) user.role_id = role_id;
      if(cuit !== null) user.cuit = cuit;

      await user.save();

      return res.status(200).json(user);
    } catch (error) {
      return res.status(500).json({error: error.message});
    }
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
