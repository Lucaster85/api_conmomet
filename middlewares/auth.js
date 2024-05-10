const { verifyToken } = require("../helpers");
const db = require('../models');

exports.verifyToken = async (req, res, next) => {
    
    if (!req.headers.authorization) return res.status(401).json({"error": "No token provided"});
    
    const token = req.headers.authorization.replace(/^Bearer\s+/, "");

    try {
        const verify = verifyToken(token);
        console.log("ID: ", verify.user.id);
        const user = await db.User.findByPk(verify.user.id);
        console.log("USER: ", verify.user);
        req.body.user = user;
    } catch (error) {
        return res.status(500).json({error});
    }
    next();
}
