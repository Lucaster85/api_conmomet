"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class CompanyPointOfSale extends Model {}
  CompanyPointOfSale.init({
    number: { type: DataTypes.INTEGER, allowNull: false },
    usage_description: { type: DataTypes.STRING(150), allowNull: true },
    type: { type: DataTypes.ENUM("web_service", "manual"), allowNull: false, defaultValue: "web_service" },
    address: { type: DataTypes.STRING(255), allowNull: true },
    is_default: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  }, {
    sequelize,
    modelName: "CompanyPointOfSale",
    tableName: "CompanyPointsOfSale",
    timestamps: true,
    underscored: true,
  });
  return CompanyPointOfSale;
};
