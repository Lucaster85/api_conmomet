const db = require("../models");

/**
 * Línea de tiempo append-only del ida y vuelta del PC (ver FLOWS.md flujo 27g). Nunca puede
 * romper la operación que ya se aplicó — mismo criterio que sendPushToUsers — así que absorbe
 * cualquier error y solo lo loguea. No se espera (fire-and-forget) en los controllers: la
 * respuesta no depende de que esta escritura termine.
 */
async function writeStatusLog({ quoteRequestId, event, fromStatus, toStatus, changedBy, comment, recipientIds }) {
  try {
    const log = await db.QuoteRequestStatusLog.create({
      quote_request_id: quoteRequestId,
      event,
      from_status: fromStatus || null,
      to_status: toStatus,
      changed_by: changedBy,
      comment: comment ? String(comment).trim() : null,
    });
    if (recipientIds && recipientIds.length > 0) {
      await log.setRecipients(recipientIds);
    }
  } catch (error) {
    console.error(`[quote-request-log] error registrando evento "${event}" del PC ${quoteRequestId}:`, error.message);
  }
}

/**
 * Todos los que "participaron" de un PC, sin repetidos: los responsables actuales, cualquiera que
 * haya sido destinatario de algún evento anterior de su línea de tiempo (asignado, devuelto,
 * reasignado… — los ex-responsables también), y quien creó el PC. `extraUserIds` suma a quien
 * el llamador sabe que participó por otra vía (ej. quien armó el presupuesto); `excludeUserId`
 * saca a quien dispara la acción, que no necesita enterarse de lo que hizo él mismo.
 */
async function resolveQuoteRequestParticipants(quoteRequestId, { extraUserIds = [], excludeUserId = null } = {}) {
  const quoteRequest = await db.QuoteRequest.findByPk(quoteRequestId, {
    attributes: ["id", "created_by"],
    include: [{ model: db.User, as: "assignees", attributes: ["id"], through: { attributes: [] } }],
  });
  if (!quoteRequest) return [];

  const pastRecipientLogs = await db.QuoteRequestStatusLog.findAll({
    where: { quote_request_id: quoteRequestId },
    attributes: ["id"],
    include: [{ model: db.User, as: "recipients", attributes: ["id"], through: { attributes: [] } }],
  });

  const ids = new Set();
  (quoteRequest.assignees || []).forEach((u) => ids.add(u.id));
  pastRecipientLogs.forEach((log) => (log.recipients || []).forEach((u) => ids.add(u.id)));
  if (quoteRequest.created_by) ids.add(quoteRequest.created_by);
  extraUserIds.filter(Boolean).forEach((id) => ids.add(id));
  if (excludeUserId) ids.delete(excludeUserId);

  return [...ids];
}

module.exports = { writeStatusLog, resolveQuoteRequestParticipants };
