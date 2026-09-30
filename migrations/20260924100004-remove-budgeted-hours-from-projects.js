"use strict";
const { DataTypes } = require("sequelize");

/**
 * Reemplazado por ProjectHourBudgets (bolsas por rubro) — el total presupuestado del proyecto
 * pasa a ser la suma de esas bolsas, una sola fuente de verdad. Los valores existentes ya se
 * migraron a la bolsa "Generales" en 20260924100003.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.removeColumn("Projects", "budgeted_hours");
  },
  async down(queryInterface) {
    await queryInterface.addColumn("Projects", "budgeted_hours", {
      type: DataTypes.DECIMAL(8, 2),
      defaultValue: 0,
    });
  },
};
