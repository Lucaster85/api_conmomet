"use strict";
const { DataTypes } = require("sequelize");

/**
 * Valor de referencia de la hora "actual" por cliente para presupuestos de OCA de horas hombre.
 * Concepto deliberadamente separado de ClientItemRate (tarifas del módulo de Presupuestos de
 * obra) — no comparte tabla ni BudgetItemType para que nunca aparezca como rubro seleccionable
 * en Presupuestos. Mismo patrón que ClientItemRate (ver
 * 20260826100002-create-client-item-rates.js) pero sin budget_item_type_id ni currency.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("OcaClientRates", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      client_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Clients", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      hourly_rate: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
      updated_by: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("OcaClientRates", ["client_id"], { unique: true });
  },
  async down(queryInterface) {
    await queryInterface.dropTable("OcaClientRates");
  },
};
