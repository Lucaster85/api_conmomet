"use strict";
const { DataTypes } = require("sequelize");

/**
 * Mismo discriminador oca_type que OcaClientRates (ver 20260921100001), acá sin índice único —
 * es log de auditoría append-only. Igual criterio de nullable + backfill + NOT NULL por si hay
 * filas de prueba en local/test (todas de man_hours, único tipo que existía hasta ahora).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("OcaClientRateHistories", "oca_type", {
      type: DataTypes.ENUM("man_hours", "crane_hours"),
      allowNull: true,
    });
    await queryInterface.sequelize.query('UPDATE `OcaClientRateHistories` SET `oca_type` = \'man_hours\' WHERE `oca_type` IS NULL;');
    await queryInterface.changeColumn("OcaClientRateHistories", "oca_type", {
      type: DataTypes.ENUM("man_hours", "crane_hours"),
      allowNull: false,
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn("OcaClientRateHistories", "oca_type");
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_OcaClientRateHistories_oca_type";');
  },
};
