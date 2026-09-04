"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("Budgets", "labor_discount_percent", {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: false,
      defaultValue: 0,
      comment: "Bonificación % sobre el subtotal de mano de obra, aplicable desde 'sent' en adelante",
    });
    await queryInterface.addColumn("Budgets", "material_discount_percent", {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: false,
      defaultValue: 0,
      comment: "Bonificación % sobre el subtotal de materiales, aplicable desde 'sent' en adelante",
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn("Budgets", "material_discount_percent");
    await queryInterface.removeColumn("Budgets", "labor_discount_percent");
  },
};
