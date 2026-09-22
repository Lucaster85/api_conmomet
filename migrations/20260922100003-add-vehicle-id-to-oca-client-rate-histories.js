"use strict";
const { DataTypes } = require("sequelize");

/**
 * Mismo criterio que OcaClientRates (ver 20260922100002) — vehicle_id para poder distinguir el
 * historial de precio por vehículo en OCAs de grúa. Sin índice único, es log de auditoría.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const table = await queryInterface.describeTable("OcaClientRateHistories");
    if (!table.vehicle_id) {
      await queryInterface.addColumn("OcaClientRateHistories", "vehicle_id", {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Vehicles", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      });
    }
  },
  async down(queryInterface) {
    await queryInterface.removeColumn("OcaClientRateHistories", "vehicle_id");
  },
};
