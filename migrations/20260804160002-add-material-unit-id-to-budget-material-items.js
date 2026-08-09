"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("BudgetMaterialItems", "material_unit_id", {
      type: DataTypes.INTEGER,
      // Nullable acá a propósito: se completa en la migración de backfill
      // (20260804160003-backfill-budget-material-item-units.js) y recién se vuelve
      // NOT NULL en 20260804160004-finalize-budget-material-item-unit.js, una vez que
      // todas las filas existentes ya tienen un material_unit_id asignado.
      allowNull: true,
      references: { model: "MaterialUnits", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    });
    await queryInterface.addIndex("BudgetMaterialItems", ["material_unit_id"]);
  },
  async down(queryInterface) {
    await queryInterface.removeIndex("BudgetMaterialItems", ["material_unit_id"]);
    await queryInterface.removeColumn("BudgetMaterialItems", "material_unit_id");
  },
};
