"use strict";
const { DataTypes } = require("sequelize");

/**
 * El precio al cliente de una línea de material deja de cargarse a mano: se calcula desde
 * material_cost_snapshot * (1 + margin_percent/100). Backfill: a las líneas existentes con
 * costo cargado se les infiere el margen que ya tenían implícito en unit_price, para no
 * resetearlas a 0% — ver FLOWS.md.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("BudgetMaterialItems", "margin_percent", {
      type: DataTypes.DECIMAL(6, 2),
      allowNull: false,
      defaultValue: 0,
      comment: "Margen % sobre material_cost_snapshot — unit_price se calcula desde acá, no se carga directo",
    });

    await queryInterface.sequelize.query(`
      UPDATE BudgetMaterialItems
      SET margin_percent = ROUND(((unit_price / material_cost_snapshot) - 1) * 100, 2)
      WHERE material_cost_snapshot IS NOT NULL AND material_cost_snapshot > 0
    `);
  },
  async down(queryInterface) {
    await queryInterface.removeColumn("BudgetMaterialItems", "margin_percent");
  },
};
