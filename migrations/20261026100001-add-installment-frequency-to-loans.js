"use strict";
const { DataTypes } = require("sequelize");

/**
 * Loans.installment_frequency: cuotas 'monthly' o 'biweekly' (quincenales) para los préstamos de
 * cuota fija. Migración solo aditiva: no toca montos, saldos, cuotas ni estados.
 *
 * - Los `fixed_installments` ya existentes quedan en 'monthly' (sus cuotas ya generadas siguen
 *   igual, no se recalculan).
 * - Los `discretionary` quedan en NULL (no tienen cuotas).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("Loans", "installment_frequency", {
      type: DataTypes.ENUM("monthly", "biweekly"),
      allowNull: true,
    });
    await queryInterface.sequelize.query(
      "UPDATE Loans SET installment_frequency = 'monthly' WHERE plan_type = 'fixed_installments'"
    );
  },
  async down(queryInterface) {
    await queryInterface.removeColumn("Loans", "installment_frequency");
  },
};
