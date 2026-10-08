"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Alícuotas de IVA que se pueden elegir al cargar una factura. Arranca solo con 21%; si el
    // cliente necesita otra la agrega desde Configuración General. Cada factura guarda la
    // alícuota que usó, así que quitar una de la lista no toca las facturas ya cargadas.
    await queryInterface.addColumn("SystemSettings", "invoice_iva_rates", {
      type: DataTypes.JSON,
      allowNull: true,
    });
    await queryInterface.sequelize.query(
      `UPDATE SystemSettings SET invoice_iva_rates = JSON_ARRAY(21) WHERE invoice_iva_rates IS NULL`
    );
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("SystemSettings", "invoice_iva_rates");
  },
};
