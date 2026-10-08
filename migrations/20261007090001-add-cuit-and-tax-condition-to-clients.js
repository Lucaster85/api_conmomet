"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Datos fiscales del cliente, opcionales: los usa Facturación (muestra el CUIT y la condición
    // frente al IVA) y dejan preparada la integración con ARCA. CUIT guardado solo con dígitos
    // (11), sin guiones; no es único porque un mismo cliente puede estar cargado dos veces
    // (una por planta).
    await queryInterface.addColumn("Clients", "cuit", {
      type: DataTypes.STRING(11),
      allowNull: true,
    });
    await queryInterface.addColumn("Clients", "tax_condition", {
      type: DataTypes.ENUM("responsable_inscripto", "monotributo", "exento", "consumidor_final", "no_responsable"),
      allowNull: true,
    });
    await queryInterface.addIndex("Clients", ["cuit"], { name: "clients_cuit_idx" });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex("Clients", "clients_cuit_idx");
    await queryInterface.removeColumn("Clients", "tax_condition");
    await queryInterface.removeColumn("Clients", "cuit");
  },
};
