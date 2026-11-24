"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("Budgets", "client_budget_number", {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: "N° con el que el CLIENTE identifica este presupuesto (el que referencian sus OC) — texto libre, no se valida formato ni unicidad. Distinto de QuoteRequests.client_quote_number, que identifica el pedido",
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn("Budgets", "client_budget_number");
  },
};
