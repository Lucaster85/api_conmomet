"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("Projects", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      name: { type: DataTypes.STRING(150), allowNull: false },
      code: { type: DataTypes.STRING(30), unique: true },
      client_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Clients", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      plant_id: { type: DataTypes.INTEGER, references: { model: "Plants", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
      description: { type: DataTypes.TEXT },
      budgeted_hours: { type: DataTypes.DECIMAL(8, 2), defaultValue: 0 },
      status: { type: DataTypes.ENUM("draft", "active", "paused", "completed", "cancelled"), defaultValue: "active" },
      start_date: { type: DataTypes.DATEONLY },
      end_date: { type: DataTypes.DATEONLY },
      notes: { type: DataTypes.TEXT },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      deleted_at: { type: DataTypes.DATE },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable("Projects");
  },
};
