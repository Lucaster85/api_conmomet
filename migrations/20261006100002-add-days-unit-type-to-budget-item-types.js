"use strict";
const { DataTypes } = require("sequelize");

/**
 * Suma "days" a BudgetItemTypes.unit_type: un rubro por días se carga y se cotiza en días, y cada
 * día equivale a 9 hs en la bolsa de horas del proyecto (ver helpers/laborUnits.js).
 *
 * DOWN: falla a propósito si hay rubros marcados como "days" — con MySQL no estricto el ENUM los
 * convertiría en '' sin avisar. Hay que pasarlos a otro tipo antes de revertir.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.changeColumn("BudgetItemTypes", "unit_type", {
      type: DataTypes.ENUM("hours", "units", "days"),
      allowNull: false,
    });
  },
  async down(queryInterface) {
    const [rows] = await queryInterface.sequelize.query("SELECT COUNT(*) AS total FROM BudgetItemTypes WHERE unit_type = 'days'");
    if (Number(rows[0].total) > 0) {
      throw new Error("Hay rubros con unit_type 'days': cambialos a 'hours' o 'units' antes de revertir esta migración.");
    }
    await queryInterface.changeColumn("BudgetItemTypes", "unit_type", {
      type: DataTypes.ENUM("hours", "units"),
      allowNull: false,
    });
  },
};
