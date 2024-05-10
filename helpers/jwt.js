const jwt = require("jsonwebtoken");

exports.createToken = (user) => jwt.sign({ user }, "secret", { expiresIn: "1h" });

exports.verifyToken = (token) => jwt.verify(token, "secret");
