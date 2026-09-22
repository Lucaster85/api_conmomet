"use strict";
const { DataTypes } = require("sequelize");

/**
 * Precio congelado por línea de OCA — a diferencia de Oca.hourly_rate (un único valor por OCA,
 * usado para man_hours), una OCA de grúa puede tener varios vehículos con precios distintos, así
 * que el valor se congela a nivel línea. Al cargar el precio de un vehículo se actualizan todas
 * las OcaLine de ese vehículo dentro de la OCA (ver ocaController.setHourlyRate).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("OcaLines", "hourly_rate", {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn("OcaLines", "hourly_rate");
  },
};
