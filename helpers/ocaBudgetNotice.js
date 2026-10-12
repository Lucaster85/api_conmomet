const db = require("../models");
const { notify } = require("./notificationService");

/**
 * Avisa al usuario configurado en Configuración General que hay una OCA nueva esperando
 * presupuesto (ver FLOWS.md flujo 38). Aviso de ACCIÓN: lo dispara alguien aprobando la OCA (o
 * corrigiendo el flag después), así que no necesita el barrido oportunista de los vencimientos.
 *
 * Destinatario único y global, igual que el aviso del tablero (OcaBudgetAlert.tsx): el campo
 * `oca_budget_notification_user_id` de la fila única de SystemSettings. Si está sin configurar,
 * no hay a quién avisarle y se omite en silencio.
 *
 * NUNCA LANZA: va después de guardar.
 */
async function notifyOcaBudgetPending(oca, actorUserId) {
  try {
    if (!oca || !oca.requires_budget) return;
    if (oca.budget_status && oca.budget_status !== "pendiente") return;

    const settings = await db.SystemSetting.findByPk(1);
    const targetUserId = settings && settings.oca_budget_notification_user_id;
    if (!targetUserId) return;

    const typeLabel = oca.type === "crane_hours" ? "Grúa" : "Horas Hombre";
    await notify([targetUserId], {
      type: "oca_budget_pending",
      title: "OCA pendiente de presupuesto",
      body: `${oca.number} (${typeLabel}) fue aprobada y requiere presupuesto`,
      url: `/dashboard/ocas?type=${oca.type}&budget_filter=pendiente`,
      tag: `oca-budget-${oca.id}`,
      entity: { type: "oca", id: oca.id },
      excludeUserId: actorUserId,
    });
  } catch (error) {
    console.error(`[oca-budget] no se pudo avisar el presupuesto pendiente de la OCA ${oca && oca.id}:`, error.message);
  }
}

module.exports = { notifyOcaBudgetPending };
