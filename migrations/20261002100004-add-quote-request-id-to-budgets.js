"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("Budgets", "quote_request_id", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "QuoteRequests", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });
    await queryInterface.addIndex("Budgets", ["quote_request_id"]);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("Budgets", "quote_request_id");
  },
};
