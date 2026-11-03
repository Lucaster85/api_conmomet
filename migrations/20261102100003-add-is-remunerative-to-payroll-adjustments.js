"use strict";
const { DataTypes } = require("sequelize");

/**
 * PayrollAdjustments.is_remunerative: un premio "no remunerativo" (viáticos, suma no remunerativa
 * por categoría) se paga igual pero no integra la base del aguinaldo. Solo tiene sentido para
 * type = 'bonus'. Default true: los premios existentes quedan como remunerativos, sin backfill
 * (PLAN_SAC.md §6.2).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("PayrollAdjustments", "is_remunerative", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("PayrollAdjustments", "is_remunerative");
  },
};
