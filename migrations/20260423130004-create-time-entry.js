"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("TimeEntries", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      employee_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Employees", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      project_id: { type: DataTypes.INTEGER },
      plant_id: { type: DataTypes.INTEGER, references: { model: "Plants", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
      date: { type: DataTypes.DATEONLY, allowNull: false },
      check_in: { type: DataTypes.TIME, allowNull: false },
      check_out: { type: DataTypes.TIME, allowNull: false },
      regular_hours: { type: DataTypes.DECIMAL(4, 2), allowNull: false },
      overtime_50_hours: { type: DataTypes.DECIMAL(4, 2), defaultValue: 0 },
      overtime_100_hours: { type: DataTypes.DECIMAL(4, 2), defaultValue: 0 },
      is_late: { type: DataTypes.BOOLEAN, defaultValue: false },
      notes: { type: DataTypes.TEXT },
      registered_by: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Users", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      approved_by: { type: DataTypes.INTEGER, references: { model: "Users", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
      approved_at: { type: DataTypes.DATE },
      status: { type: DataTypes.ENUM("pending", "approved", "voided"), defaultValue: "pending" },
      voided_by: { type: DataTypes.INTEGER, references: { model: "Users", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
      voided_at: { type: DataTypes.DATE },
      void_reason: { type: DataTypes.TEXT },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      deleted_at: { type: DataTypes.DATE },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable("TimeEntries");
  },
};
