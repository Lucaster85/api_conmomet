"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Sin "lost": una grúa/vehículo patentado no se "extravía" como sí puede pasar con una
    // herramienta chica (decisión confirmada con el usuario). Campo independiente de
    // is_active (que hoy gatea si el vehículo aparece en los selects de carga de horas/OCAs) —
    // ver Punto Abierto B del plan.
    await queryInterface.addColumn("Vehicles", "status", {
      type: DataTypes.ENUM("available", "reserved", "delivered", "in_repair", "retired"),
      allowNull: false,
      defaultValue: "available",
    });

    await queryInterface.addIndex("Vehicles", ["status"]);
  },

  async down(queryInterface) {
    await queryInterface.removeIndex("Vehicles", ["status"]);
    await queryInterface.removeColumn("Vehicles", "status");
  },
};
