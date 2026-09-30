"use strict";
const { DataTypes } = require("sequelize");

/**
 * Bolsa de horas presupuestadas por rubro en un proyecto — reemplaza a Project.budgeted_hours
 * (un único total) por una fila por (project_id, budget_item_type_id). budget_item_type_id NULL
 * representa la bolsa "Generales" (horas sin rubro definido) — no se crea un rubro especial en
 * BudgetItemTypes para esto, así nadie puede editarlo/borrarlo desde el ABM de rubros. Unicidad
 * de la fila "Generales" por proyecto es a nivel aplicación (MySQL permite múltiples NULL en un
 * índice único, pero el código nunca crea más de una) — mismo criterio que vehicle_id en
 * OcaClientRates.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("ProjectHourBudgets", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      project_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Projects", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      budget_item_type_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "BudgetItemTypes", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      budgeted_hours: { type: DataTypes.DECIMAL(8, 2), allowNull: false, defaultValue: 0 },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("ProjectHourBudgets", ["project_id", "budget_item_type_id"], { unique: true });
  },
  async down(queryInterface) {
    await queryInterface.dropTable("ProjectHourBudgets");
  },
};
