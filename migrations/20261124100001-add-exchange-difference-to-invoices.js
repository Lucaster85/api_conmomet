"use strict";
const { DataTypes } = require("sequelize");

/**
 * Notas por diferencia de cambio (PLAN_ARCA.md etapa 10, FLOWS.md §73; las pide Bunge para las facturas en dólares). Es una nota de débito (el dólar subió) o de
 * crédito (bajó) EN PESOS asociada a la factura en dólares, por la diferencia entre la cotización de la factura y la de cobro.
 * - Invoices.exchange_difference: marca la nota. No es una nota común: es en pesos sobre una factura en dólares, no libera ni resta saldo del presupuesto,
 *   y su nota de crédito no baja lo que falta cobrar de la factura (están en monedas distintas).
 * - exchange_diff_base_rate / exchange_diff_new_rate / exchange_diff_base_usd: los datos del cálculo (cotización de la factura, cotización nueva y neto en USD
 *   sobre el que se calcula), para mostrarlos y recalcular al editar el borrador.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("Invoices", "exchange_difference", { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
    await queryInterface.addColumn("Invoices", "exchange_diff_base_rate", { type: DataTypes.DECIMAL(18, 6), allowNull: true });
    await queryInterface.addColumn("Invoices", "exchange_diff_new_rate", { type: DataTypes.DECIMAL(18, 6), allowNull: true });
    await queryInterface.addColumn("Invoices", "exchange_diff_base_usd", { type: DataTypes.DECIMAL(14, 2), allowNull: true });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("Invoices", "exchange_diff_base_usd");
    await queryInterface.removeColumn("Invoices", "exchange_diff_new_rate");
    await queryInterface.removeColumn("Invoices", "exchange_diff_base_rate");
    await queryInterface.removeColumn("Invoices", "exchange_difference");
  },
};
