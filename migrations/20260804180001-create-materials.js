"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Arranca vacía a propósito — el catálogo se puebla vía ABM, import de Excel, o alta
    // rápida inline desde el formulario de Presupuesto. No se auto-migra ningún texto libre
    // ya cargado en BudgetMaterialItems.description (ver FLOWS.md).
    await queryInterface.createTable("Materials", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      description: { type: DataTypes.STRING(255), allowNull: false },
      material_unit_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "MaterialUnits", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      current_cost: {
        type: DataTypes.DECIMAL(14, 2),
        allowNull: true,
        comment: "Nullable: el alta rápida inline puede crear el material sin costo si quien lo crea no tiene permiso material_costs_read",
      },
      currency: { type: DataTypes.ENUM("ARS", "USD"), allowNull: true },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      deleted_at: { type: DataTypes.DATE },
    });
    await queryInterface.addIndex("Materials", ["material_unit_id"]);
  },
  async down(queryInterface) {
    await queryInterface.dropTable("Materials");
  },
};
