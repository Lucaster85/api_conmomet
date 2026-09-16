"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // MySQL requiere redefinir el ENUM completo vía MODIFY COLUMN (changeColumn). No muta
    // datos existentes, solo agrega el valor permitido "biweekly_fixed" (figura "Quincenal Fijo").
    await queryInterface.changeColumn("Employees", "pay_type", {
      type: DataTypes.ENUM("hourly", "monthly", "biweekly_fixed"),
      defaultValue: "hourly",
      allowNull: false,
    });
  },

  async down(queryInterface) {
    // Falla si ya hay empleados con pay_type='biweekly_fixed' — esperado, hay que
    // reasignarlos a otra figura antes de hacer downgrade.
    await queryInterface.changeColumn("Employees", "pay_type", {
      type: DataTypes.ENUM("hourly", "monthly"),
      defaultValue: "hourly",
      allowNull: false,
    });
  },
};
