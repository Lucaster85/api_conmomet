"use strict";
const { DataTypes } = require("sequelize");

/**
 * Control de concurrencia optimista para la edición de un presupuesto en borrador (ver
 * FLOWS.md §35). `revision` es un contador entero, no se usa `updated_at` como token de
 * versión porque en MySQL `DATETIME` no guarda fracción de segundo: dos guardados dentro del
 * mismo segundo serían indistinguibles. `last_edited_by`/`last_edited_at` son para el mensaje
 * del 409 ("Juan Pérez guardó cambios...") y para el aviso de presencia del frontend.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("Budgets", "revision", {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.addColumn("Budgets", "last_edited_by", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Users", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });
    await queryInterface.addColumn("Budgets", "last_edited_at", {
      type: DataTypes.DATE,
      allowNull: true,
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn("Budgets", "last_edited_at");
    await queryInterface.removeColumn("Budgets", "last_edited_by");
    await queryInterface.removeColumn("Budgets", "revision");
  },
};
