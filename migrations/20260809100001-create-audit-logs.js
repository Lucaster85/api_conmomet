"use strict";
const { DataTypes } = require("sequelize");

/**
 * Log de auditoría genérico y append-only para operaciones con valores en $
 * (préstamos, tarifas, ajustes de liquidación, presupuestos, etc.). No lleva
 * deleted_at/paranoid a propósito, mismo criterio que MaterialCostHistory.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("AuditLogs", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      entity_type: { type: DataTypes.STRING(50), allowNull: false },
      entity_id: { type: DataTypes.INTEGER, allowNull: false },
      action: { type: DataTypes.ENUM("create", "update", "delete"), allowNull: false },
      field_changed: { type: DataTypes.STRING(100), allowNull: true },
      previous_value: { type: DataTypes.STRING(255), allowNull: true },
      new_value: { type: DataTypes.STRING(255), allowNull: true },
      amount: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
      context: { type: DataTypes.JSON, allowNull: true },
      performed_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      notes: { type: DataTypes.TEXT, allowNull: true },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("AuditLogs", ["entity_type", "entity_id"]);
    await queryInterface.addIndex("AuditLogs", ["performed_by"]);
    await queryInterface.addIndex("AuditLogs", ["created_at"]);
  },
  async down(queryInterface) {
    await queryInterface.dropTable("AuditLogs");
  },
};
