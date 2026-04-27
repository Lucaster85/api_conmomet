"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("Employees", "shoe_size", { type: DataTypes.STRING(10) });
    await queryInterface.addColumn("Employees", "shirt_size", { type: DataTypes.STRING(10) });
    await queryInterface.addColumn("Employees", "pant_size", { type: DataTypes.STRING(10) });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn("Employees", "shoe_size");
    await queryInterface.removeColumn("Employees", "shirt_size");
    await queryInterface.removeColumn("Employees", "pant_size");
  },
};
