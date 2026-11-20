"use strict";
const { DataTypes } = require("sequelize");

/**
 * Budgets.purchase_order_not_required (PLAN_ARCA.md §3.1, etapa 6): "este presupuesto no lleva OC". Hace que deje de aparecer el aviso del tablero
 * "Presupuesto aprobado sin OC". Es reversible (se puede volver a pedir la OC). Los presupuestos ya aprobados arrancan en false: no se marca nada solo.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("Budgets", "purchase_order_not_required", {
      type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false,
      comment: "El cliente no emite OC para este presupuesto: no avisar que falta.",
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn("Budgets", "purchase_order_not_required");
  },
};
