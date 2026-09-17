"use strict";
const { DataTypes } = require("sequelize");

/**
 * Registro de auditoría append-only del valor de referencia de OCA por cliente — nunca se edita
 * ni se borra. Mismo criterio que ClientItemRateHistory/MaterialCostHistory.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("OcaClientRateHistories", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      client_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Clients", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      hourly_rate: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
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
    await queryInterface.addIndex("OcaClientRateHistories", ["client_id"]);
  },
  async down(queryInterface) {
    await queryInterface.dropTable("OcaClientRateHistories");
  },
};
