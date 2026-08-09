"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("BudgetMaterialItems", "material_cost_snapshot", {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      comment: "Costo del Material al momento de vincular esta línea — foto fija, no se recalcula si el costo del material cambia después",
    });
    await queryInterface.addColumn("BudgetMaterialItems", "material_cost_currency", {
      type: DataTypes.ENUM("ARS", "USD"),
      allowNull: true,
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn("BudgetMaterialItems", "material_cost_currency");
    await queryInterface.removeColumn("BudgetMaterialItems", "material_cost_snapshot");
  },
};
