"use strict";
const { DataTypes } = require("sequelize");

/**
 * Puntos de venta del emisor (PLAN_ARCA.md §3.0). Los da de alta el cliente en ARCA; acá solo se cargan y se validan.
 * `web_service` se puede usar por API; `manual` es de "Comprobantes en línea" (solo carga manual). No se borran si ya
 * tienen facturas (la FK de Invoices, en la etapa 2, es RESTRICT): se desactivan.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("CompanyPointsOfSale", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      number: { type: DataTypes.INTEGER, allowNull: false, comment: "Número de punto de venta (1 a 99999)." },
      usage_description: { type: DataTypes.STRING(150), allowNull: true, comment: 'Para qué se usa, ej. "Obras con IIBB".' },
      type: { type: DataTypes.ENUM("web_service", "manual"), allowNull: false, defaultValue: "web_service" },
      address: { type: DataTypes.STRING(255), allowNull: true, comment: "Domicilio asociado en ARCA. Vacío = el de la empresa." },
      is_default: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("CompanyPointsOfSale", ["number"], { name: "company_pos_number_unique", unique: true });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("CompanyPointsOfSale");
  },
};
