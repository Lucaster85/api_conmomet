"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class CompanyBankAccount extends Model {}
  CompanyBankAccount.init({
    bank_name: { type: DataTypes.STRING(100), allowNull: false },
    cbu: { type: DataTypes.STRING(22), allowNull: false },
    alias: { type: DataTypes.STRING(20), allowNull: true },
    currency: { type: DataTypes.ENUM("ARS", "USD"), allowNull: true },
    is_default: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  }, {
    sequelize,
    modelName: "CompanyBankAccount",
    tableName: "CompanyBankAccounts",
    timestamps: true,
    underscored: true,
  });
  return CompanyBankAccount;
};
