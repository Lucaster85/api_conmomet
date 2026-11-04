"use strict";

const BASE = "'regular','extras_50','extras_100','holiday','fixed','retroactive','vacation','medical_leave','justified','medical_leave_deduction','vacation_deduction','absence_deduction','sac','sac_adjustment'";
const FINAL = [
  "final_days", "sac_proportional", "vacation_unused", "vacation_unused_sac", "notice_pay", "notice_pay_sac",
  "month_integration", "month_integration_sac", "severance", "severance_agreed", "overpaid_deduction", "employee_notice_deduction",
];
const FINAL_SQL = FINAL.map((t) => `'${t}'`).join(",");

/**
 * Líneas de la liquidación final (PLAN_EGRESOS.md §6.1) y lo que hace falta para poder corregir un
 * monto con motivo: `suggested_amount` (lo que propuso el cálculo), `edit_reason` (por qué se
 * cambió) e `item_key` (identifica el concepto, para que regenerar respete lo editado).
 *
 * También ensancha gross_amount / net_amount de PayrollEntries a DECIMAL(14,2): una indemnización
 * de varios años se acerca al tope de DECIMAL(10,2).
 *
 * DOWN: falla a propósito si hay líneas de los tipos nuevos (ver 20261102100001).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE PayrollLines
      MODIFY COLUMN line_type ENUM(${BASE},${FINAL_SQL})
      NOT NULL DEFAULT 'regular'
    `);
    await queryInterface.addColumn("PayrollLines", "suggested_amount", { type: Sequelize.DECIMAL(14, 2), allowNull: true });
    await queryInterface.addColumn("PayrollLines", "edit_reason", { type: Sequelize.TEXT, allowNull: true });
    await queryInterface.addColumn("PayrollLines", "item_key", { type: Sequelize.STRING(60), allowNull: true });

    await queryInterface.sequelize.query("ALTER TABLE PayrollEntries MODIFY COLUMN gross_amount DECIMAL(14,2) NULL");
    await queryInterface.sequelize.query("ALTER TABLE PayrollEntries MODIFY COLUMN net_amount DECIMAL(14,2) NULL");
  },

  async down(queryInterface) {
    const [rows] = await queryInterface.sequelize.query(`SELECT COUNT(*) AS total FROM PayrollLines WHERE line_type IN (${FINAL_SQL})`);
    if (Number(rows[0].total) > 0) {
      throw new Error("Hay líneas de liquidación final: borralas antes de revertir esta migración.");
    }
    await queryInterface.removeColumn("PayrollLines", "item_key");
    await queryInterface.removeColumn("PayrollLines", "edit_reason");
    await queryInterface.removeColumn("PayrollLines", "suggested_amount");
    await queryInterface.sequelize.query(`
      ALTER TABLE PayrollLines
      MODIFY COLUMN line_type ENUM(${BASE})
      NOT NULL DEFAULT 'regular'
    `);
    await queryInterface.sequelize.query("ALTER TABLE PayrollEntries MODIFY COLUMN gross_amount DECIMAL(10,2) NULL");
    await queryInterface.sequelize.query("ALTER TABLE PayrollEntries MODIFY COLUMN net_amount DECIMAL(10,2) NULL");
  },
};
