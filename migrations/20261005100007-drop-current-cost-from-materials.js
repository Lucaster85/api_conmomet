"use strict";
const { DataTypes } = require("sequelize");

/**
 * Última migración del cambio: el costo vive en MaterialProviderPrices. El down re-crea las
 * columnas y restaura los valores desde el precio del proveedor "Sin especificar".
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.removeColumn("Materials", "current_cost");
    await queryInterface.removeColumn("Materials", "currency");
  },
  async down(queryInterface) {
    await queryInterface.addColumn("Materials", "current_cost", {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
    });
    await queryInterface.addColumn("Materials", "currency", {
      type: DataTypes.ENUM("ARS", "USD"),
      allowNull: true,
    });
    await queryInterface.sequelize.query(`
      UPDATE Materials m
      JOIN MaterialProviderPrices p ON p.material_id = m.id
        AND p.provider_id = (SELECT id FROM Providers WHERE is_system = true LIMIT 1)
      SET m.current_cost = p.cost, m.currency = p.currency
    `);
  },
};
