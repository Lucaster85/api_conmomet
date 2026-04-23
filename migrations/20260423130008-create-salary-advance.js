"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("SalaryAdvances", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      employee_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Employees", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      date: { type: DataTypes.DATEONLY, allowNull: false },
      pay_period_id: { type: DataTypes.INTEGER, references: { model: "PayPeriods", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
      notes: { type: DataTypes.TEXT },
      approved_by: { type: DataTypes.INTEGER, references: { model: "Users", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      deleted_at: { type: DataTypes.DATE },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable("SalaryAdvances");
  },
};
