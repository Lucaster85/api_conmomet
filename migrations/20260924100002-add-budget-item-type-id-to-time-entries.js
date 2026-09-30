"use strict";
const { DataTypes } = require("sequelize");

/**
 * Rubro de PROYECTO al que corresponden estas horas (Montaje, Construcción, etc.) — eje
 * totalmente distinto de concept_id/PayrollConcept (que es el concepto de liquidación/pago).
 * Una hora puede ser concepto "General" para el pago y rubro "Montaje" para el consumo del
 * proyecto. Opcional: sin rubro, la hora cuenta para la bolsa "Generales" del proyecto (ver
 * ProjectHourBudgets, 20260924100001).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("TimeEntries", "budget_item_type_id", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "BudgetItemTypes", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn("TimeEntries", "budget_item_type_id");
  },
};
