"use strict";
const { DataTypes } = require("sequelize");

/**
 * Fila-candado de la numeración de ARCA (PLAN_ARCA.md §8, B6): una por (ambiente, punto de venta, tipo de comprobante).
 * Se bloquea con FOR UPDATE mientras se pide el último número autorizado y se emite, así dos emisiones simultáneas del
 * mismo punto de venta y tipo no pueden reservar el mismo número. No guarda el número: la fuente de verdad es ARCA.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("ArcaSequences", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      env: { type: DataTypes.ENUM("homologacion", "produccion"), allowNull: false },
      pos_number: { type: DataTypes.INTEGER, allowNull: false },
      cbte_tipo: { type: DataTypes.INTEGER, allowNull: false },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("ArcaSequences", ["env", "pos_number", "cbte_tipo"], { name: "arca_sequences_scope_unique", unique: true });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("ArcaSequences");
  },
};
