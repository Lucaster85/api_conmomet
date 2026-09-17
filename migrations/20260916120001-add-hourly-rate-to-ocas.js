"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Valor de referencia de la hora CONGELADO para esta OCA puntual (igual criterio que
    // OcaLine, que ya es un snapshot fijo de TimeEntry) — no se recalcula si después cambia el
    // valor vigente del cliente en OcaClientRate.
    await queryInterface.addColumn("Ocas", "hourly_rate", {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("Ocas", "hourly_rate");
  },
};
