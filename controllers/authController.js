const db = require("../models");
const { encryptPass, createToken, verifyPass } = require("../helpers");
const permission = require("../models/permission");

module.exports = {
  create: async (req, res) => {
    const { name, lastname, email, password, role_id, cuit, permissions, role } = req.body;

    const hashPass = await encryptPass(password);

    try {
      const user = await db.User.create({
        name,
        lastname,
        email,
        password: hashPass,
        role_id,
        cuit,
        // permissions: [permissions]
      });

      const token = createToken(user);

      return res.status(200).json(token);
    } catch (error) {
      return res.status(500).json({error: error.message});
    }
  },
  login: async (req, res) => {
    try {
      const user = await db.User.findOne({ where: { email: req.body.email }, include: "role" });

      const verify = await verifyPass(req.body.password, user.password);

      if (!verify) {
        return res.status(404).json({"error": "Email o contraseña incorrectos"});
      }

      const token = createToken(user)
      return res.status(200).json({user, token});
    } catch (error) {
      return res.status(500).json(error);
    }
  },
};
