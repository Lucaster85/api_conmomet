"use strict";
const { DataTypes } = require("sequelize");

/**
 * Materiales cargados a una OCA de horas hombre — sin precio, es un registro tipo remito
 * (material + cantidad) que se imprime como sección aparte al final del documento simple
 * ("Imprimir Remito"), no del presupuesto por día. Solo aplica a Ocas.type === "man_hours".
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("OcaMaterialItems", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      oca_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Ocas", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      material_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Materials", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
        comment: "Vínculo opcional al catálogo de materiales — una línea puede seguir siendo solo texto libre",
      },
      description: { type: DataTypes.STRING(255), allowNull: false },
      quantity: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      material_unit_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "MaterialUnits", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      notes: { type: DataTypes.TEXT },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      deleted_at: { type: DataTypes.DATE },
    });
    await queryInterface.addIndex("OcaMaterialItems", ["oca_id"]);
  },
  async down(queryInterface) {
    await queryInterface.dropTable("OcaMaterialItems");
  },
};
