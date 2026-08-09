"use strict";
const { DataTypes } = require("sequelize");

/**
 * Distingue "quién cargó la aprobación en el sistema" (Budget.approved_by, un User interno,
 * ya existente) de "quién aprobó del lado del cliente" (este campo, un ClientSupervisor
 * externo — mismo concepto que ya usa Oca.supervisor_id, pero acá capturado al momento de
 * aprobar, no al crear el documento).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("Budgets", "approved_by_supervisor_id", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "ClientSupervisors", key: "id" },
      onUpdate: "CASCADE",
      // SET NULL (no RESTRICT): es un dato informativo, no debe bloquear borrar un contacto.
      onDelete: "SET NULL",
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn("Budgets", "approved_by_supervisor_id");
  },
};
