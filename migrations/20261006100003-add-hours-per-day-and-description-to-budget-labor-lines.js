"use strict";
const { DataTypes } = require("sequelize");

/**
 * hours_per_day: horas que vale cada unidad de la línea cuando su rubro es por días (9). Null en
 * rubros por horas o unidades y en líneas existentes. Se guarda en la línea a propósito: si el
 * valor o el tipo del rubro cambian después, los presupuestos ya armados no se alteran.
 *
 * description: texto libre de la línea, para el "Detalle de mano de obra" del presupuesto. No se
 * reusa `notes` ni Budget.notes (notas internas).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("BudgetLaborLines", "hours_per_day", {
      type: DataTypes.DECIMAL(4, 2),
      allowNull: true,
    });
    await queryInterface.addColumn("BudgetLaborLines", "description", {
      type: DataTypes.TEXT,
      allowNull: true,
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn("BudgetLaborLines", "description");
    await queryInterface.removeColumn("BudgetLaborLines", "hours_per_day");
  },
};
