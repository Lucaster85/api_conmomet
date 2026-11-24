"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

// Fila única (id: 1), sembrada en helpers/seed.js. Datos del emisor de las facturas (PLAN_ARCA.md §3.0).
module.exports = () => {
  class CompanyProfile extends Model {}
  CompanyProfile.init({
    legal_name: { type: DataTypes.STRING(150), allowNull: true },
    display_name: { type: DataTypes.STRING(150), allowNull: true },
    cuit: { type: DataTypes.STRING(11), allowNull: true },
    address_street: { type: DataTypes.STRING(150), allowNull: true },
    address_number: { type: DataTypes.STRING(20), allowNull: true },
    address_locality: { type: DataTypes.STRING(100), allowNull: true },
    address_province: { type: DataTypes.STRING(100), allowNull: true },
    vat_condition: { type: DataTypes.ENUM("responsable_inscripto", "monotributo", "exento"), allowNull: false, defaultValue: "responsable_inscripto" },
    iibb_number: { type: DataTypes.STRING(30), allowNull: true },
    activity_start_date: { type: DataTypes.DATEONLY, allowNull: true },
    email: { type: DataTypes.STRING(150), allowNull: true },
    phone: { type: DataTypes.STRING(50), allowNull: true },
    fce_transfer_option: { type: DataTypes.ENUM("SCA", "ADC"), allowNull: false, defaultValue: "SCA" },
  }, {
    sequelize,
    modelName: "CompanyProfile",
    tableName: "CompanyProfiles",
    timestamps: true,
    underscored: true,
  });
  return CompanyProfile;
};
