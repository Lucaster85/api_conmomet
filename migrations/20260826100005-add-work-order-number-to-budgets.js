"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("Budgets", "work_order_number", {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: "N° de OT libre que asigna el cliente — solo para rastreo, no se valida formato ni unicidad",
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn("Budgets", "work_order_number");
  },
};
