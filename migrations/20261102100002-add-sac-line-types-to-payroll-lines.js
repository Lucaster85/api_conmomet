"use strict";

/**
 * Suma "sac" y "sac_adjustment" a PayrollLines.line_type:
 * - sac: la línea del aguinaldo en la liquidación del período SAC.
 * - sac_adjustment: diferencia de un SAC ya liquidado, que se paga en una quincena posterior.
 * Ver PLAN_SAC.md §4.2 y §5.
 *
 * DOWN: falla a propósito si hay líneas "sac"/"sac_adjustment" (ver 20261102100001).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE PayrollLines
      MODIFY COLUMN line_type ENUM('regular','extras_50','extras_100','holiday','fixed','retroactive','vacation','medical_leave','justified','medical_leave_deduction','vacation_deduction','absence_deduction','sac','sac_adjustment')
      NOT NULL DEFAULT 'regular'
    `);
  },

  async down(queryInterface) {
    const [rows] = await queryInterface.sequelize.query("SELECT COUNT(*) AS total FROM PayrollLines WHERE line_type IN ('sac', 'sac_adjustment')");
    if (Number(rows[0].total) > 0) {
      throw new Error("Hay líneas de liquidación con line_type 'sac' o 'sac_adjustment': borralas antes de revertir esta migración.");
    }
    await queryInterface.sequelize.query(`
      ALTER TABLE PayrollLines
      MODIFY COLUMN line_type ENUM('regular','extras_50','extras_100','holiday','fixed','retroactive','vacation','medical_leave','justified','medical_leave_deduction','vacation_deduction','absence_deduction')
      NOT NULL DEFAULT 'regular'
    `);
  },
};
