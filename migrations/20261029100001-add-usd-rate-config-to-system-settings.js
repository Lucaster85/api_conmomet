"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Fuente de la cotización del dólar que se usa para descontar cuotas de préstamos en USD en
    // la liquidación. Configurable para que el cliente pueda cambiar de criterio sin un deploy.
    await queryInterface.addColumn("SystemSettings", "usd_rate_casa", {
      type: DataTypes.ENUM("oficial", "blue", "mayorista", "bolsa"),
      allowNull: false,
      defaultValue: "oficial",
    });
    await queryInterface.addColumn("SystemSettings", "usd_rate_side", {
      type: DataTypes.ENUM("venta", "compra"),
      allowNull: false,
      defaultValue: "venta",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("SystemSettings", "usd_rate_side");
    await queryInterface.removeColumn("SystemSettings", "usd_rate_casa");
  },
};
