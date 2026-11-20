"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

// Fila-candado de la numeración (services/arca/emission.js): una por (ambiente, punto de venta, tipo de comprobante).
module.exports = () => {
  class ArcaSequence extends Model {}
  ArcaSequence.init({
    env: { type: DataTypes.ENUM("homologacion", "produccion"), allowNull: false },
    pos_number: { type: DataTypes.INTEGER, allowNull: false },
    cbte_tipo: { type: DataTypes.INTEGER, allowNull: false },
  }, {
    sequelize,
    modelName: "ArcaSequence",
    tableName: "ArcaSequences",
    timestamps: true,
    underscored: true,
  });
  return ArcaSequence;
};
