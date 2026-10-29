"use strict";
const { DataTypes } = require("sequelize");

/**
 * Cotización del dólar congelada para la quincena, usada para descontar en pesos las cuotas de
 * préstamos en USD. `usd_exchange_rate_locked_at` es la marca de "definitiva": NULL mientras la
 * quincena sigue abierta (provisoria o recién resuelta), se setea al cerrar y desde ahí el recibo
 * no vuelve a consultar ninguna API.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("PayPeriods", "usd_exchange_rate", {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
    });
    await queryInterface.addColumn("PayPeriods", "usd_exchange_rate_date", {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: "Fecha de la regla (end_date + 1) a la que corresponde la cotización, para trazabilidad del recibo.",
    });
    await queryInterface.addColumn("PayPeriods", "usd_exchange_rate_source", {
      type: DataTypes.ENUM("api", "manual"),
      allowNull: true,
    });
    await queryInterface.addColumn("PayPeriods", "usd_exchange_rate_locked_at", {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "NULL = provisoria (quincena abierta). Se setea al cerrar: desde ahí es definitiva.",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("PayPeriods", "usd_exchange_rate_locked_at");
    await queryInterface.removeColumn("PayPeriods", "usd_exchange_rate_source");
    await queryInterface.removeColumn("PayPeriods", "usd_exchange_rate_date");
    await queryInterface.removeColumn("PayPeriods", "usd_exchange_rate");
  },
};
