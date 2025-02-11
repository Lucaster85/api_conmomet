const db = require("../models");
const { encryptPass, createToken, verifyPass } = require("../helpers");
const permission = require("../models/permission");

module.exports = {
  create: async (req, res) => {
    let {
      name,
      lastname,
      email,
      password,
      role_id,
      cuit,
      phone,
      celphone,
      permissions,
    } = req.body;

    
    try {
      const hashPass = await encryptPass(password);
      if (!role_id) {
        const defaultRole = await db.Role.findOne({ where: { name: "user" } });
        role_id = defaultRole.id;
      }
      const user = await db.User.create({
        name,
        lastname,
        email,
        password: hashPass,
        role_id,
        cuit,
        phone,
        celphone,
      });

      const token = createToken(user);

      return res.status(200).json(token);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
  login: async (req, res) => {
    try {
      const user = await db.User.findOne({
        where: {
          email: req.body.email,
        },
        include: [
          {
            model: db.Role,
            as: "role",
            include: "permissions",
          },
          "permissions",
        ],
      });

      const verify = await verifyPass(req.body.password, user.password);

      if (!verify) {
        return res
          .status(401)
          .json({ error: "Email o contraseña incorrectos" });
      }

      const token = createToken(user);
      // res.setHeader('Set-Cookie', token)
      return res.status(200).json({ user, token });
    } catch (error) {
      return res.status(500).json(error);
    }
  },
};
