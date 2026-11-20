"use strict";
const { DataTypes } = require("sequelize");

/**
 * Cuentas bancarias del emisor (PLAN_ARCA.md §3.0). Se elige una al facturar (la predeterminada viene precargada); el
 * CBU y el alias se imprimen en el PDF y van como opcionales en la FCE.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("CompanyBankAccounts", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      bank_name: { type: DataTypes.STRING(100), allowNull: false },
      cbu: { type: DataTypes.STRING(22), allowNull: false, comment: "22 dígitos, con dígito verificador válido." },
      alias: { type: DataTypes.STRING(20), allowNull: true },
      currency: { type: DataTypes.ENUM("ARS", "USD"), allowNull: true, comment: "Null = sirve para cualquiera." },
      is_default: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("CompanyBankAccounts", ["cbu"], { name: "company_bank_cbu_unique", unique: true });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("CompanyBankAccounts");
  },
};
