"use strict";
const { DataTypes } = require("sequelize");

/**
 * "Datos de mi empresa" (PLAN_ARCA.md §3.0): el emisor de las facturas. Fila única (id 1, mismo criterio que
 * SystemSettings), sembrada en helpers/seed.js. Sin certificado, clave ni ambiente de ARCA: eso va en variables de entorno.
 * El logo para el PDF entra en la etapa 3.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("CompanyProfiles", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      legal_name: { type: DataTypes.STRING(150), allowNull: true, comment: "Razón social." },
      display_name: { type: DataTypes.STRING(150), allowNull: true, comment: "Nombre para el encabezado de la factura." },
      cuit: { type: DataTypes.STRING(11), allowNull: true, comment: "Solo dígitos." },
      address_street: { type: DataTypes.STRING(150), allowNull: true },
      address_number: { type: DataTypes.STRING(20), allowNull: true },
      address_locality: { type: DataTypes.STRING(100), allowNull: true },
      address_province: { type: DataTypes.STRING(100), allowNull: true },
      vat_condition: {
        type: DataTypes.ENUM("responsable_inscripto", "monotributo", "exento"),
        allowNull: false, defaultValue: "responsable_inscripto",
      },
      iibb_number: { type: DataTypes.STRING(30), allowNull: true },
      activity_start_date: { type: DataTypes.DATEONLY, allowNull: true },
      email: { type: DataTypes.STRING(150), allowNull: true },
      phone: { type: DataTypes.STRING(50), allowNull: true },
      fce_transfer_option: {
        type: DataTypes.ENUM("SCA", "ADC"), allowNull: false, defaultValue: "SCA",
        comment: "Opción de transferencia de la FCE por defecto; el cliente puede tener la suya.",
      },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("CompanyProfiles");
  },
};
