"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Los clientes no se eliminan, se desactivan — un cliente inactivo deja de aparecer como
    // opción en los selectores (OCAs, Presupuestos, Proyectos, Plantas) pero los registros
    // históricos que ya lo referencian (OCAs, presupuestos, tarifas) no se ven afectados.
    await queryInterface.addColumn("Clients", "is_active", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("Clients", "is_active");
  },
};
