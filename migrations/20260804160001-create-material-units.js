"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("MaterialUnits", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      label: { type: DataTypes.STRING(20), allowNull: false, unique: true },
      display_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      deleted_at: { type: DataTypes.DATE },
    });

    const now = new Date();
    await queryInterface.bulkInsert("MaterialUnits", [
      { label: "u", display_order: 1, is_active: true, created_at: now, updated_at: now },
      { label: "kg", display_order: 2, is_active: true, created_at: now, updated_at: now },
      { label: "L", display_order: 3, is_active: true, created_at: now, updated_at: now },
      { label: "m", display_order: 4, is_active: true, created_at: now, updated_at: now },
      { label: "m²", display_order: 5, is_active: true, created_at: now, updated_at: now },
      { label: "m³", display_order: 6, is_active: true, created_at: now, updated_at: now },
      { label: "viajes", display_order: 7, is_active: true, created_at: now, updated_at: now },
      { label: "bolsa", display_order: 8, is_active: true, created_at: now, updated_at: now },
      { label: "rollo", display_order: 9, is_active: true, created_at: now, updated_at: now },
      { label: "caja", display_order: 10, is_active: true, created_at: now, updated_at: now },
    ]);
  },
  async down(queryInterface) {
    await queryInterface.dropTable("MaterialUnits");
  },
};
