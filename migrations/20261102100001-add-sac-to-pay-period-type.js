"use strict";

/**
 * Suma "sac" a PayPeriods.type: el aguinaldo se liquida como un período más (uno por semestre,
 * month = 6 | 12), aparte de las quincenas. Ver PLAN_SAC.md §3.
 *
 * DOWN: falla a propósito si hay períodos "sac" — con MySQL no estricto el ENUM los convertiría
 * en '' sin avisar. Hay que borrarlos antes de revertir.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE PayPeriods
      MODIFY COLUMN type ENUM('first_half','second_half','sac') NOT NULL
    `);
  },

  async down(queryInterface) {
    const [rows] = await queryInterface.sequelize.query("SELECT COUNT(*) AS total FROM PayPeriods WHERE type = 'sac'");
    if (Number(rows[0].total) > 0) {
      throw new Error("Hay períodos de liquidación con type 'sac': borralos antes de revertir esta migración.");
    }
    await queryInterface.sequelize.query(`
      ALTER TABLE PayPeriods
      MODIFY COLUMN type ENUM('first_half','second_half') NOT NULL
    `);
  },
};
