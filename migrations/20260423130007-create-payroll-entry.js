"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("PayrollEntries", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      pay_period_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "PayPeriods", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      employee_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Employees", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      total_regular_hours: { type: DataTypes.DECIMAL(6, 2) },
      total_overtime_50_hours: { type: DataTypes.DECIMAL(6, 2) },
      total_overtime_100_hours: { type: DataTypes.DECIMAL(6, 2) },
      regular_amount: { type: DataTypes.DECIMAL(10, 2) },
      overtime_50_amount: { type: DataTypes.DECIMAL(10, 2) },
      overtime_100_amount: { type: DataTypes.DECIMAL(10, 2) },
      extra_payments: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
      extra_payments_notes: { type: DataTypes.TEXT },
      gross_amount: { type: DataTypes.DECIMAL(10, 2) },
      deductions: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
      deductions_notes: { type: DataTypes.TEXT },
      advances_deducted: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
      net_amount: { type: DataTypes.DECIMAL(10, 2) },
      late_count: { type: DataTypes.INTEGER, defaultValue: 0 },
      absent_count: { type: DataTypes.INTEGER, defaultValue: 0 },
      status: { type: DataTypes.ENUM("draft", "confirmed", "paid"), defaultValue: "draft" },
      paid_at: { type: DataTypes.DATE },
      notes: { type: DataTypes.TEXT },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      deleted_at: { type: DataTypes.DATE },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable("PayrollEntries");
  },
};
