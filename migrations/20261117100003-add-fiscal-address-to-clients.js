"use strict";
const { DataTypes } = require("sequelize");

/**
 * Domicilio comercial fiscal del cliente (PLAN_ARCA.md §4): sale en el bloque del receptor de la factura. Es el del padrón de
 * ARCA, que puede no coincidir con el de la OC (Bunge figura en Tancacha, Córdoba, aunque su OC diga Quequén). Opcional;
 * a futuro se autocompleta con el Padrón A13 (etapa 10).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("Clients", "fiscal_street", { type: DataTypes.STRING(150), allowNull: true, comment: "Calle y número." });
    await queryInterface.addColumn("Clients", "fiscal_locality", { type: DataTypes.STRING(100), allowNull: true });
    await queryInterface.addColumn("Clients", "fiscal_province", { type: DataTypes.STRING(100), allowNull: true });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn("Clients", "fiscal_province");
    await queryInterface.removeColumn("Clients", "fiscal_locality");
    await queryInterface.removeColumn("Clients", "fiscal_street");
  },
};
