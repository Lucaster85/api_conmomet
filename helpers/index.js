const { encryptPass, verifyPass } = require('./encryptPass');
const { createToken, verifyToken } = require('./jwt');

module.exports = {
    encryptPass,
    createToken,
    verifyPass,
    verifyToken
}