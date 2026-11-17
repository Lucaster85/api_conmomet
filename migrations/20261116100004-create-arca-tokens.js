"use strict";
const { DataTypes } = require("sequelize");

/**
 * Ticket de acceso de WSAA (token + sign), PLAN_ARCA.md §4 y §8 (B7, S1). Se guarda por (env, cuit, service) para no
 * reutilizarlo nunca entre ambientes, y CIFRADO (AES-256-GCM): con token + sign + CUIT alcanza para emitir facturas
 * durante 12 horas sin el certificado, y esta tabla viaja en los backups de la base. Nunca sale por la API.
 * Las columnas cifradas son nullable: la fila se crea vacía para poder bloquearla (FOR UPDATE) al serializar el login.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("ArcaTokens", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      env: { type: DataTypes.ENUM("homologacion", "produccion"), allowNull: false },
      cuit: { type: DataTypes.STRING(11), allowNull: false },
      service: { type: DataTypes.STRING(20), allowNull: false, comment: "Servicio de ARCA, ej. wsfe." },
      token_encrypted: { type: DataTypes.TEXT, allowNull: true },
      sign_encrypted: { type: DataTypes.TEXT, allowNull: true },
      generated_at: { type: DataTypes.DATE, allowNull: true },
      expires_at: { type: DataTypes.DATE, allowNull: true },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("ArcaTokens", ["env", "cuit", "service"], { name: "arca_tokens_scope_unique", unique: true });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("ArcaTokens");
  },
};
