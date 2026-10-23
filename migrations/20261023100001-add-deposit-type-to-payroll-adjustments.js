"use strict";
const { DataTypes } = require("sequelize");

/**
 * Suma "deposit" a PayrollAdjustments.type: el "Recibo / Depósito" es la parte del sueldo que se
 * paga por depósito en vez de en efectivo. Resta del neto igual que un descuento (así el neto de
 * la liquidación es el efectivo a pagar), pero queda identificado aparte para la planilla de la
 * quincena (columna "Depósito").
 *
 * DOWN: falla a propósito si hay ajustes "deposit" — con MySQL no estricto el ENUM los
 * convertiría en '' sin avisar. Hay que borrarlos o pasarlos a otro tipo antes de revertir.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.changeColumn("PayrollAdjustments", "type", {
      type: DataTypes.ENUM("bonus", "deduction", "deposit"),
      allowNull: false,
    });
  },
  async down(queryInterface) {
    const [rows] = await queryInterface.sequelize.query("SELECT COUNT(*) AS total FROM PayrollAdjustments WHERE type = 'deposit'");
    if (Number(rows[0].total) > 0) {
      throw new Error("Hay ajustes de liquidación con type 'deposit': borralos o cambialos de tipo antes de revertir esta migración.");
    }
    await queryInterface.changeColumn("PayrollAdjustments", "type", {
      type: DataTypes.ENUM("bonus", "deduction"),
      allowNull: false,
    });
  },
};
