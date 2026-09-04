"use strict";
const { DataTypes } = require("sequelize");

/**
 * Registro de auditoría append-only de la tarifa de un rubro por cliente — nunca se edita ni
 * se borra. Mismo criterio que MaterialCostHistory.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("ClientItemRateHistories", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      client_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Clients", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      budget_item_type_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "BudgetItemTypes", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      rate: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
      currency: { type: DataTypes.ENUM("ARS", "USD"), allowNull: false },
      changed_by: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("ClientItemRateHistories", ["client_id", "budget_item_type_id"]);
  },
  async down(queryInterface) {
    await queryInterface.dropTable("ClientItemRateHistories");
  },
};
