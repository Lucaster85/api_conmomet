"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.changeColumn("BudgetMaterialItems", "material_unit_id", {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "MaterialUnits", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    });
    await queryInterface.removeColumn("BudgetMaterialItems", "unit");
  },
  async down(queryInterface) {
    await queryInterface.addColumn("BudgetMaterialItems", "unit", {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: "u",
    });
    await queryInterface.changeColumn("BudgetMaterialItems", "material_unit_id", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "MaterialUnits", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    });
  },
};
