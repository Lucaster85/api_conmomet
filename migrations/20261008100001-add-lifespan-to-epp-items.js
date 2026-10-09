"use strict";
const { DataTypes } = require("sequelize");

/**
 * Vida útil sugerida de un artículo de EPP: al registrar una entrega, precarga el vencimiento
 * como fecha_entrega + N meses (ver helpers/eppExpiration.js). Null = se entrega a demanda y
 * no tiene vencimiento (p.ej. guantes).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("EppItems", "lifespan_months", {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "Vida útil sugerida en meses. Null = sin vencimiento, se entrega a demanda.",
    });
    await queryInterface.addColumn("EppItems", "notify_days_before", {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 15,
      comment: "Días de anticipación para avisar el vencimiento. Se copia a la entrega al momento de crearla.",
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn("EppItems", "notify_days_before");
    await queryInterface.removeColumn("EppItems", "lifespan_months");
  },
};
