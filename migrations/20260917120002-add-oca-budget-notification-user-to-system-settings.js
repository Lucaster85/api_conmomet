"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Usuario configurado globalmente para ver el aviso de "OCAs aprobadas pendientes de
    // presupuesto" en su dashboard — no es por OCA, en este cliente siempre es la misma persona.
    await queryInterface.addColumn("SystemSettings", "oca_budget_notification_user_id", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Users", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("SystemSettings", "oca_budget_notification_user_id");
  },
};
