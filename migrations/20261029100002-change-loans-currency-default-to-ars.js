"use strict";
const { DataTypes } = require("sequelize");

/**
 * `Loans.currency` defaulteaba a "USD" — inofensivo mientras esa rama estaba congelada (todos
 * los inserts pasan la moneda explícita), pero ahora que vuelve a estar viva, un insert futuro
 * que omita el campo nacería en dólares sin que nadie lo note. Solo cambia el default; no toca
 * filas existentes.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.changeColumn("Loans", "currency", {
      type: DataTypes.ENUM("USD", "ARS"),
      allowNull: false,
      defaultValue: "ARS",
    });
  },

  async down(queryInterface) {
    await queryInterface.changeColumn("Loans", "currency", {
      type: DataTypes.ENUM("USD", "ARS"),
      allowNull: false,
      defaultValue: "USD",
    });
  },
};
