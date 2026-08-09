const db = require("../models");

/**
 * Audit Log Service
 *
 * Punto único para dejar rastro de creaciones, actualizaciones y bajas que
 * involucran valores en $ (préstamos, tarifas, ajustes de liquidación,
 * presupuestos, etc.). No registra toda la actividad del sistema — solo se
 * llama explícitamente desde los controllers en los puntos donde un valor
 * monetario relevante cambia.
 */
module.exports = {
  /**
   * @param {object} params
   * @param {string} params.entityType - p. ej. "Loan", "PayrollAdjustment"
   * @param {number} params.entityId - PK del registro afectado
   * @param {"create"|"update"|"delete"} params.action
   * @param {string} [params.fieldChanged] - p. ej. "amount", "rate", "status"
   * @param {*} [params.previousValue]
   * @param {*} [params.newValue]
   * @param {number} [params.amount] - monto $ relevante de esta entrada
   * @param {object} [params.context] - detalle libre (ids relacionados, snapshot de un bulk-op, etc.)
   * @param {number} [params.userId] - actor (req.user?.id)
   * @param {string} [params.notes]
   * @param {import('sequelize').Transaction} [transaction]
   */
  recordAudit: async (
    { entityType, entityId, action, fieldChanged, previousValue, newValue, amount, context, userId, notes },
    transaction
  ) => {
    return db.AuditLog.create(
      {
        entity_type: entityType,
        entity_id: entityId,
        action,
        field_changed: fieldChanged ?? null,
        previous_value: previousValue !== undefined && previousValue !== null ? String(previousValue) : null,
        new_value: newValue !== undefined && newValue !== null ? String(newValue) : null,
        amount: amount ?? null,
        context: context ?? null,
        performed_by: userId ?? null,
        notes: notes ?? null,
      },
      transaction ? { transaction } : undefined
    );
  },
};
