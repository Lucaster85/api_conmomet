const jwt = require("jsonwebtoken");

const SECRET = process.env.JWT_SECRET || "secret";

exports.createToken = (user) => jwt.sign({ id: user.id, role_id: user.role_id }, SECRET, { expiresIn: "1h" });

exports.verifyToken = (token) => jwt.verify(token, SECRET);
