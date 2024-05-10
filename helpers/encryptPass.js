const bcrypt = require('bcryptjs');

exports.encryptPass = async pass => {
    const salt = await bcrypt.genSalt(12);
    return await bcrypt.hash(pass, salt);
}

exports.verifyPass = async (pass, hash) => {
    return await bcrypt.compare(pass, hash);
}