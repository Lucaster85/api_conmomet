"use strict";
const { DataTypes } = require("sequelize");

/**
 * Precio de un Material por Proveedor. cost nulo = "este proveedor lo tiene, sin precio aún".
 * No es paranoid: el vínculo se borra de verdad (el historial vive en MaterialCostHistories).
 * UNIQUE(material_id, provider_id) sin columnas nullable en la clave, así que MySQL lo respeta.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("MaterialProviderPrices", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      material_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Materials", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      provider_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Providers", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      cost: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
      currency: { type: DataTypes.ENUM("ARS", "USD"), allowNull: true },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("MaterialProviderPrices", ["material_id", "provider_id"], {
      unique: true,
      name: "material_provider_prices_material_provider_unique",
    });
    await queryInterface.addIndex("MaterialProviderPrices", ["provider_id"]);
  },
  async down(queryInterface) {
    await queryInterface.dropTable("MaterialProviderPrices");
  },
};
