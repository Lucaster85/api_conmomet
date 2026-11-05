"use strict";
const { DataTypes } = require("sequelize");

/**
 * Responsable del seguimiento de un presupuesto enviado (ver FLOWS.md §51): quien lo envió, o sea
 * quien tiene que conseguir la respuesta del cliente. No es `approved_by` (quién cargó la
 * aprobación) ni `approved_by_supervisor_id` (el contacto del cliente que aprobó).
 *
 * Backfill de los que hoy están en `sent`: el `performed_by` del último registro de auditoría
 * `status → sent` (flujo §35). Los que no tengan auditoría quedan sin responsable y no aparecen en
 * ninguna tarjeta. Es una función aparte, exportada, para poder probarla contra la auditoría.
 */
async function backfillFollowupUsers(queryInterface) {
  await queryInterface.sequelize.query(`
    UPDATE Budgets b
    SET b.followup_user_id = (
      SELECT a.performed_by
      FROM AuditLogs a
      WHERE a.entity_type = 'Budget'
        AND a.entity_id = b.id
        AND a.field_changed = 'status'
        AND a.new_value = 'sent'
        AND a.performed_by IN (SELECT u.id FROM Users u)
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT 1
    )
    WHERE b.status = 'sent' AND b.followup_user_id IS NULL
  `);
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("Budgets", "followup_user_id", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Users", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });
    await queryInterface.addIndex("Budgets", ["followup_user_id", "status"], { name: "budgets_followup_user_status" });
    await backfillFollowupUsers(queryInterface);
  },

  async down(queryInterface) {
    await queryInterface.removeIndex("Budgets", "budgets_followup_user_status");
    await queryInterface.removeColumn("Budgets", "followup_user_id");
  },

  backfillFollowupUsers,
};
