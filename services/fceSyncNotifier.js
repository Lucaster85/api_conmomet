const db = require("../models");
const { Op } = require("sequelize");
const { notifyOnce } = require("./expirationNotifier");
const { resolveUserIdsByPermission } = require("../helpers/pushService");
const { getArcaConfig } = require("./arca/credentials");
const { CBTE_TIPO, CBTE_TIPO_LABELS } = require("./arca/codes");
const fceSync = require("./arca/fceSync");

/**
 * Barrido automático del seguimiento de FCE con ARCA (FLOWS.md flujo 78). Mismo patrón oportunista que el de vencimientos (flujo 38): no hay scheduler, así que
 * corre cuando alguien entra a la app (lo llama GET /me/notifications/unread-count sin await), con un throttle de 6 horas sobre `SystemSettings.last_fce_sync_at`.
 * Ese campo es el mismo del botón "Sincronizar con ARCA": una sincronización a mano también cuenta para el throttle.
 *
 * Un fallo de ARCA (servicio sin autorizar, red) solo se loguea: nunca rompe el latido. El turno ya se consumió, así que no se reintenta hasta dentro de 6 horas
 * (reintentar en cada latido castigaría a ARCA mientras está caída).
 */
const THROTTLE_HOURS = 6;
const FCE_URL = "/dashboard/billing?tab=fce";

// Resultado de una factura a partir de los cambios detectados: Rechazada gana a Aceptada. Solo cuenta si ya teníamos un estado anterior de esa factura: la primera vez que
// se ve una FCE (`from` null) no es "una novedad", y la primera corrida en producción avisaría de cada FCE vieja.
function outcomesOf(changes) {
  const outcomes = new Map();
  for (const change of changes) {
    if (change.from === null || change.from === undefined) continue;
    const accepted = (change.field === "fce_cmp_state" && change.to === "Aceptado") || (change.field === "fce_account_state" && change.to === "Aceptada");
    const rejected = (change.field === "fce_cmp_state" && change.to === "Rechazado") || (change.field === "fce_account_state" && change.to === "Rechazada");
    if (rejected) outcomes.set(change.invoice_id, "rejected");
    else if (accepted && outcomes.get(change.invoice_id) !== "rejected") outcomes.set(change.invoice_id, "accepted");
  }
  return outcomes;
}

/**
 * Campanita: avisa a quienes tienen acceso a Facturación (`invoices_read`, mismo criterio que las cauciones) que una FCE pasó a Aceptada o Rechazada.
 * Una sola vez por usuario y por factura y tipo (`notifyOnce`). Solo las facturas, no sus notas. Nunca lanza.
 * @returns {Promise<number>} notificaciones creadas
 */
async function notifyFceChanges(changes) {
  try {
    const outcomes = outcomesOf(changes || []);
    if (outcomes.size === 0) return 0;
    const recipients = await resolveUserIdsByPermission("invoices_read");
    if (recipients.length === 0) return 0;

    const invoices = await db.Invoice.findAll({
      where: { id: { [Op.in]: [...outcomes.keys()] }, kind: "invoice", cbte_tipo: CBTE_TIPO.FCE_A_FACTURA },
      include: [{ model: db.Client, as: "client", attributes: ["razonSocial"] }],
    });
    let sent = 0;
    for (const invoice of invoices) {
      const rejected = outcomes.get(invoice.id) === "rejected";
      const label = `${CBTE_TIPO_LABELS[invoice.cbte_tipo]} ${String(invoice.pos_number).padStart(4, "0")}-${String(invoice.number).padStart(8, "0")}`;
      const who = invoice.client ? invoice.client.razonSocial : invoice.manual_recipient ? invoice.manual_recipient.legal_name : null;
      sent += await notifyOnce(recipients, {
        type: rejected ? "fce_rejected" : "fce_accepted",
        entityType: "invoice",
        entityId: invoice.id,
        title: rejected ? "FCE rechazada por el cliente" : "FCE aceptada",
        body: `${label}${who ? ` — ${who}` : ""}${rejected ? ": hay que emitir la nota de crédito de anulación" : ""}`,
        url: FCE_URL,
      });
    }
    return sent;
  } catch (error) {
    console.error("[fce-sync] no se pudieron crear las notificaciones:", error.message);
    return 0;
  }
}

/**
 * NUNCA LANZA (mismo contrato que syncExpirationNotifications): se la llama sin await desde un endpoint de lectura.
 * No corre si la integración con ARCA está apagada; si wsfecred no está autorizado, ARCA falla y queda solo en el log.
 */
async function syncFceStatuses() {
  const summary = { ran: false, checked: 0, updated: 0, notified: 0 };
  try {
    const config = getArcaConfig();
    if (!config.enabled) return summary;

    const result = await fceSync.syncAll(null, { intervalMs: THROTTLE_HOURS * 60 * 60 * 1000, restoreOnFailure: false, silentWhenBusy: true });
    if (!result) return summary;
    summary.ran = true;
    summary.checked = result.checked;
    summary.updated = result.updated;
    summary.notified = await notifyFceChanges(result.changes);
    if (result.updated > 0) console.log(`[fce-sync] ${result.checked} FCE revisadas, ${result.updated} cambiaron, ${summary.notified} notificaciones`);
  } catch (error) {
    summary.ran = true;
    console.error("[fce-sync] la sincronización automática falló:", error.message);
  }
  return summary;
}

module.exports = { syncFceStatuses, notifyFceChanges, outcomesOf, THROTTLE_HOURS };
