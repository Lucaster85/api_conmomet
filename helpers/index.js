const { encryptPass, verifyPass,  } = require('./encryptPass');
const { createToken, verifyToken } = require('./jwt');
const { permissions } = require('./permissions');

module.exports = {
    encryptPass,
    createToken,
    verifyPass,
    verifyToken,
    permissions
}