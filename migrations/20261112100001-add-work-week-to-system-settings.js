"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Semana laboral de la empresa: define qué son los "días hábiles" al calcular las vacaciones
    // proporcionales de un empleado nuevo (LCT arts. 151 y 153). Hoy trabajan de lunes a sábado.
    await queryInterface.addColumn("SystemSettings", "work_week", {
      type: DataTypes.ENUM("mon_fri", "mon_sat"),
      allowNull: false,
      defaultValue: "mon_sat",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("SystemSettings", "work_week");
  },
};
