"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

// Ticket de WSAA cifrado (services/arca/wsaa.js, tokenCrypto.js). Nunca se serializa por la API.
module.exports = () => {
  class ArcaToken extends Model {
    // Defensa en profundidad: aunque algún día un controller devuelva una fila por error, el token no sale.
    toJSON() {
      const { token_encrypted, sign_encrypted, ...safe } = this.get({ plain: true });
      return safe;
    }
  }
  ArcaToken.init({
    env: { type: DataTypes.ENUM("homologacion", "produccion"), allowNull: false },
    cuit: { type: DataTypes.STRING(11), allowNull: false },
    service: { type: DataTypes.STRING(20), allowNull: false },
    token_encrypted: { type: DataTypes.TEXT, allowNull: true },
    sign_encrypted: { type: DataTypes.TEXT, allowNull: true },
    generated_at: { type: DataTypes.DATE, allowNull: true },
    expires_at: { type: DataTypes.DATE, allowNull: true },
  }, {
    sequelize,
    modelName: "ArcaToken",
    tableName: "ArcaTokens",
    timestamps: true,
    underscored: true,
  });
  return ArcaToken;
};
