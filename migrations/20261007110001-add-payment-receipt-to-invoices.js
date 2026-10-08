"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Comprobante de pago (transferencia, recibo…) que se puede adjuntar, de forma opcional, al
    // marcar una factura como cobrada. Es un archivo aparte del PDF de la factura (file_*).
    await queryInterface.addColumn("Invoices", "payment_file_url", { type: DataTypes.STRING(500), allowNull: true });
    await queryInterface.addColumn("Invoices", "payment_file_key", { type: DataTypes.STRING(500), allowNull: true });
    await queryInterface.addColumn("Invoices", "payment_file_name", { type: DataTypes.STRING(255), allowNull: true });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("Invoices", "payment_file_name");
    await queryInterface.removeColumn("Invoices", "payment_file_key");
    await queryInterface.removeColumn("Invoices", "payment_file_url");
  },
};
