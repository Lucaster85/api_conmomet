"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("BudgetMaterialItems", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      budget_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Budgets", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
      material_id: { type: DataTypes.INTEGER, comment: "FK futura a catálogo de materiales" },
      description: { type: DataTypes.STRING(255), allowNull: false },
      quantity: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      unit: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "u" },
      unit_price: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
      currency: { type: DataTypes.ENUM("ARS", "USD"), allowNull: true, comment: "Si es null, usa la moneda del Budget" },
      total_price: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
      notes: { type: DataTypes.TEXT },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      deleted_at: { type: DataTypes.DATE },
    });
    await queryInterface.addIndex("BudgetMaterialItems", ["budget_id"]);
  },
  async down(queryInterface) {
    await queryInterface.dropTable("BudgetMaterialItems");
  },
};
