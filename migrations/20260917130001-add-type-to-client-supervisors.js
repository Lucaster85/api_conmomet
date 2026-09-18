"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Distingue contactos de obra (supervisor que aprueba remitos) de contactos de
    // administración (quien aprueba el presupuesto de la OCA) — mismo registro de "contacto
    // externo del cliente", solo se categoriza para poblar el selector correcto en cada flujo.
    // Default "obra": todos los contactos ya cargados hoy se usan para ese fin.
    await queryInterface.addColumn("ClientSupervisors", "type", {
      type: DataTypes.ENUM("obra", "administracion"),
      allowNull: false,
      defaultValue: "obra",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("ClientSupervisors", "type");
  },
};
