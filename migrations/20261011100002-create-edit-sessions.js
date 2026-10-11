"use strict";
const { DataTypes } = require("sequelize");

/**
 * Presencia ("Juan Pérez está editando esto ahora") para la edición concurrente de
 * Presupuestos (ver FLOWS.md §35). Polimórfica igual que AuditLogs (entity_type/entity_id), no
 * una FK real a Budgets — mismo criterio: hoy solo la usa Presupuestos, pero el día de mañana
 * sirve igual para cualquier otra pantalla sin migración nueva.
 *
 * Es estado efímero (el frontend la refresca con un heartbeat cada 30s), no un registro de
 * auditoría — por eso, a diferencia de AuditLogs, sin `deleted_at`/paranoid: una fila vieja se
 * sobreescribe (upsert por el índice único) o se ignora por `last_seen_at` viejo, nunca se la
 * "da de baja" formalmente.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("EditSessions", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      entity_type: { type: DataTypes.STRING(50), allowNull: false },
      entity_id: { type: DataTypes.INTEGER, allowNull: false },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      last_seen_at: { type: DataTypes.DATE, allowNull: false },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("EditSessions", ["entity_type", "entity_id", "user_id"], {
      unique: true,
      name: "edit_sessions_entity_user_unique",
    });
    await queryInterface.addIndex("EditSessions", ["entity_type", "entity_id", "last_seen_at"], {
      name: "edit_sessions_entity_last_seen",
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable("EditSessions");
  },
};
