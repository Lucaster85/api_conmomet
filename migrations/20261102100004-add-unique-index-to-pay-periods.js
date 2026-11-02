"use strict";

/**
 * Índice único (type, year, month) en PayPeriods: hay una sola quincena de cada tipo por mes y un
 * solo aguinaldo por semestre. Sin esto, `findOrCreate` del período SAC y el chequeo previo de
 * `payPeriodController.create` no son atómicos: dos pedidos simultáneos podían duplicar el período
 * y las diferencias de aguinaldo se calculaban contra uno elegido al azar.
 *
 * UP: falla a propósito si ya hay duplicados — hay que resolverlos a mano antes (borrar o
 * unificar, según tengan liquidaciones), no se borra nada automáticamente.
 */

const INDEX_NAME = "pay_periods_type_year_month_unique";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const [duplicates] = await queryInterface.sequelize.query(`
      SELECT type, year, month, COUNT(*) AS total
      FROM PayPeriods
      GROUP BY type, year, month
      HAVING COUNT(*) > 1
    `);
    if (duplicates.length > 0) {
      const detail = duplicates.map((d) => `${d.type} ${d.month}/${d.year} (x${d.total})`).join(", ");
      throw new Error(`Hay períodos duplicados que impiden crear el índice único: ${detail}. Resolvelos a mano y reintentá.`);
    }
    await queryInterface.addIndex("PayPeriods", ["type", "year", "month"], { unique: true, name: INDEX_NAME });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex("PayPeriods", INDEX_NAME);
  },
};
