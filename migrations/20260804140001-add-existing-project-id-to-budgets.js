"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("Budgets", "existing_project_id", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Projects", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
      comment: "Proyecto raíz ya existente al que este presupuesto se vincula sin generar uno nuevo (mutuamente excluyente con parent_project_id)",
    });
    await queryInterface.addIndex("Budgets", ["existing_project_id"]);
  },
  async down(queryInterface) {
    await queryInterface.removeIndex("Budgets", ["existing_project_id"]);
    await queryInterface.removeColumn("Budgets", "existing_project_id");
  },
};
