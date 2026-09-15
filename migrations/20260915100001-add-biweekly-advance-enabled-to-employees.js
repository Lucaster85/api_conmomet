"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Solo tiene efecto para pay_type='monthly' — validado a nivel aplicación, no acá (mismo
    // criterio que el resto del sistema para reglas de negocio condicionales).
    await queryInterface.addColumn("Employees", "biweekly_advance_enabled", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("Employees", "biweekly_advance_enabled");
  },
};
