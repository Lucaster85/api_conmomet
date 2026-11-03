"use strict";

/**
 * Suma "final" a PayPeriods.type: la liquidación final de los egresos se agrupa en un período por
 * mes (uno solo por (year, month), lo garantiza el índice único de 20261102100004), aparte de las
 * quincenas y del aguinaldo. Ver PLAN_EGRESOS.md §6.1.
 *
 * DOWN: falla a propósito si hay períodos "final" (ver 20261102100001).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE PayPeriods
      MODIFY COLUMN type ENUM('first_half','second_half','sac','final') NOT NULL
    `);
  },

  async down(queryInterface) {
    const [rows] = await queryInterface.sequelize.query("SELECT COUNT(*) AS total FROM PayPeriods WHERE type = 'final'");
    if (Number(rows[0].total) > 0) {
      throw new Error("Hay períodos de liquidación con type 'final': borralos antes de revertir esta migración.");
    }
    await queryInterface.sequelize.query(`
      ALTER TABLE PayPeriods
      MODIFY COLUMN type ENUM('first_half','second_half','sac') NOT NULL
    `);
  },
};
