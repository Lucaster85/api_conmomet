"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("Materials", "kg_per_meter", {
      type: DataTypes.DECIMAL(10, 3),
      allowNull: true,
      comment: "Kg por metro lineal (ejes, perfiles, etc.) — dato opcional",
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn("Materials", "kg_per_meter");
  },
};
