"use strict";
const { DataTypes } = require("sequelize");

/**
 * Registro de auditoría append-only del costo de un Material — nunca se edita ni se borra.
 * No lleva deleted_at/paranoid a propósito, mismo criterio que EmployeeRate (otra "tarifa
 * que cambia en el tiempo" en este código, tampoco paranoid).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("MaterialCostHistories", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      material_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Materials", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      cost: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
      currency: { type: DataTypes.ENUM("ARS", "USD"), allowNull: false },
      changed_by: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("MaterialCostHistories", ["material_id"]);
  },
  async down(queryInterface) {
    await queryInterface.dropTable("MaterialCostHistories");
  },
};
