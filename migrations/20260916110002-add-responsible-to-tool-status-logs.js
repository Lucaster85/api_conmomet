"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Rastro histórico de quién fue responsable en cada transición a "in_repair" — se guarda
    // solo en las filas donde to_status = "in_repair" (ver toolController.js#changeStatus).
    await queryInterface.addColumn("ToolStatusLogs", "responsible_employee_id", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Employees", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("ToolStatusLogs", "responsible_employee_id");
  },
};
