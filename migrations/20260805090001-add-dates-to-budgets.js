"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("Budgets", "start_date", {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: "Fecha de inicio prevista del proyecto — se traslada al Project al generar/vincular",
    });
    await queryInterface.addColumn("Budgets", "end_date", {
      type: DataTypes.DATEONLY,
      allowNull: true,
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn("Budgets", "end_date");
    await queryInterface.removeColumn("Budgets", "start_date");
  },
};
