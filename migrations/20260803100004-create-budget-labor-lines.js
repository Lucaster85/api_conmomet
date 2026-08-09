"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("BudgetLaborLines", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      budget_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Budgets", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
      budget_item_type_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "BudgetItemTypes", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      quantity: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      unit_price: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
      currency: { type: DataTypes.ENUM("ARS", "USD"), allowNull: true, comment: "Si es null, usa la moneda del Budget" },
      estimated_total: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
      notes: { type: DataTypes.TEXT },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      deleted_at: { type: DataTypes.DATE },
    });
    await queryInterface.addIndex("BudgetLaborLines", ["budget_id", "budget_item_type_id"], {
      unique: true,
      name: "budget_labor_lines_budget_item_type_unique",
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable("BudgetLaborLines");
  },
};
