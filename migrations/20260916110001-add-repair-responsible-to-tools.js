"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Responsable de la reparación en curso — se setea cuando status pasa a "in_repair" y se
    // limpia al salir de ese estado (ver toolController.js#changeStatus y
    // assetAssignmentController.js#returnAssignment).
    await queryInterface.addColumn("Tools", "repair_responsible_id", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Employees", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });
    await queryInterface.addIndex("Tools", ["repair_responsible_id"]);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("Tools", "repair_responsible_id");
  },
};
