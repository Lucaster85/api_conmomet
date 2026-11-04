"use strict";

/**
 * Resolución de la deuda pendiente del empleado (PLAN_EGRESOS.md §6.2): cuando los descuentos de la
 * liquidación final superan lo que se le debe, el neto queda en 0 y lo que no entró es deuda. Se
 * resuelve de una sola vez: el empleado la devolvió ("paid") o la empresa la condona ("condoned").
 * El comprobante del pago se sube como documento del egreso.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("EmployeeTerminations", "debt_resolution", {
      type: Sequelize.ENUM("paid", "condoned"),
      allowNull: true,
    });
    await queryInterface.addColumn("EmployeeTerminations", "debt_resolved_amount", { type: Sequelize.DECIMAL(14, 2), allowNull: true });
    await queryInterface.addColumn("EmployeeTerminations", "debt_resolved_at", { type: Sequelize.DATE, allowNull: true });
    await queryInterface.addColumn("EmployeeTerminations", "debt_resolved_by", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "Users", key: "id" },
    });
    await queryInterface.addColumn("EmployeeTerminations", "debt_payment_method", {
      type: Sequelize.ENUM("efectivo", "transferencia"),
      allowNull: true,
    });
    await queryInterface.addColumn("EmployeeTerminations", "debt_resolution_notes", { type: Sequelize.TEXT, allowNull: true });
  },

  async down(queryInterface) {
    for (const column of ["debt_resolution_notes", "debt_payment_method", "debt_resolved_by", "debt_resolved_at", "debt_resolved_amount", "debt_resolution"]) {
      await queryInterface.removeColumn("EmployeeTerminations", column);
    }
  },
};
