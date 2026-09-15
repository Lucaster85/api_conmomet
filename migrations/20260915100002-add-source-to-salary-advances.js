"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // "biweekly_auto": generado por el motor de liquidación al procesar la 1º quincena para
    // empleados mensualizados con biweekly_advance_enabled=true — permite distinguirlos en el
    // listado y evitar duplicarlos si se re-genera la quincena.
    await queryInterface.addColumn("SalaryAdvances", "source", {
      type: DataTypes.ENUM("manual", "biweekly_auto"),
      allowNull: false,
      defaultValue: "manual",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("SalaryAdvances", "source");
  },
};
