"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("BudgetItemTypes", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      name: { type: DataTypes.STRING(100), allowNull: false },
      unit_type: { type: DataTypes.ENUM("hours", "units"), allowNull: false },
      unit_label: { type: DataTypes.STRING(30), allowNull: false, defaultValue: "hs" },
      display_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      deleted_at: { type: DataTypes.DATE },
    });

    const now = new Date();
    await queryInterface.bulkInsert("BudgetItemTypes", [
      { name: "Hs Construcción", unit_type: "hours", unit_label: "hs", display_order: 1, is_active: true, created_at: now, updated_at: now },
      { name: "Hs Montaje", unit_type: "hours", unit_label: "hs", display_order: 2, is_active: true, created_at: now, updated_at: now },
      { name: "Hs Grúa", unit_type: "hours", unit_label: "hs", display_order: 3, is_active: true, created_at: now, updated_at: now },
      { name: "Hs Torno", unit_type: "hours", unit_label: "hs", display_order: 4, is_active: true, created_at: now, updated_at: now },
    ]);
  },
  async down(queryInterface) {
    await queryInterface.dropTable("BudgetItemTypes");
  },
};
