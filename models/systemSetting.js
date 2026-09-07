"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

// Fila única (id: 1, por convención de la app — no hay más de una fila nunca). Configuración de
// negocio editable sin re-deploy. Si hace falta otro parámetro configurable más adelante, se
// agrega como columna nueva vía migración, mismo patrón que el resto del proyecto — no hace
// falta un esquema key-value genérico para esto.
module.exports = () => {
  class SystemSetting extends Model {}
  SystemSetting.init({
    max_loan_amount_ars: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 1000000,
    },
  }, {
    sequelize,
    modelName: "SystemSetting",
    tableName: "SystemSettings",
    timestamps: true,
    underscored: true,
  });
  return SystemSetting;
};
