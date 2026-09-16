"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.removeColumn("Employees", "biweekly_advance_enabled");
  },

  async down(queryInterface) {
    await queryInterface.addColumn("Employees", "biweekly_advance_enabled", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  },
};
