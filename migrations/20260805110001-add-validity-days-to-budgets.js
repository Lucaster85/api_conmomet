"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("Budgets", "validity_days", {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 15,
      comment: "Días de vigencia desde sent_at. Solo informativo/advertencia — no bloquea aprobar un presupuesto vencido.",
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn("Budgets", "validity_days");
  },
};
