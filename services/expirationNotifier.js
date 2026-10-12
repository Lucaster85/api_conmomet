const db = require("../models");
const { Op } = require("sequelize");
const { notify } = require("../helpers/notificationService");
const { resolveUserIdsByPermission } = require("../helpers/pushService");

/**
 * Barrido de los avisos que dependen del CALENDARIO, no de una acción (ver FLOWS.md flujo 38).
 *
 * La distinción es la clave de todo este flujo: los avisos de PC, presupuestos, herramientas y
 * OCA los dispara alguien haciendo click, así que se notifican desde el controller que atiende
 * ese click. Pero "este documento vence en 15 días" no lo dispara nadie — el día que entra en
 * ventana puede que nadie toque el sistema. Alguien tiene que mirar el reloj.
 *
 * Acá eso se resuelve de forma OPORTUNISTA: el barrido corre cuando un usuario entra a la app
 * (lo llama GET /me/notifications/unread-count sin await). Sin cron, sin scheduler, sin
 * infraestructura nueva. El trade-off aceptado es que el aviso aparece cuando alguien entra, no
 * a una hora fija.
 *
 * El día que haya un scheduler, puede llamar a syncExpirationNotifications() sin cambiar nada:
 * el throttle lo deja pasar si pasó más de una hora y la idempotencia evita duplicados.
 */

const THROTTLE_HOURS = 1;

/**
 * Compare-and-swap sobre SystemSettings.last_expiration_sync_at: devuelve true solo si este
 * proceso ganó el derecho a barrer.
 *
 * Un UPDATE condicional en MySQL es atómico, así que esto resuelve DOS cosas de un saque:
 * - throttle: no barrer en cada request (sería carísimo: el barrido trae y filtra en memoria);
 * - lock: dos instancias, o dos usuarios entrando al mismo tiempo, no barren en paralelo.
 *
 * Lo segundo importa de verdad: sin lock, dos procesos pueden chequear "¿ya notifiqué?" a la vez,
 * los dos responder que no, y duplicar el aviso. Un flag en memoria del proceso cubriría el
 * throttle pero no esto.
 */
async function claimSyncSlot() {
  const cutoff = new Date(Date.now() - THROTTLE_HOURS * 60 * 60 * 1000);

  // Model.update y NO sequelize.query: para un UPDATE, query() devuelve el ResultSetHeader de
  // mysql2 en las DOS posiciones del array, no el conteo de filas — leerlo como número da NaN y
  // el CAS nunca gana (se rompió así la primera vez). Model.update devuelve [affectedCount],
  // que es lo que necesitamos y no depende del driver.
  //
  // Sigue siendo un solo UPDATE ... WHERE, así que la atomicidad —lo único que importa acá— se
  // mantiene.
  const [affected] = await db.SystemSetting.update(
    { last_expiration_sync_at: new Date() },
    {
      where: {
        id: 1,
        [Op.or]: [
          { last_expiration_sync_at: null },
          { last_expiration_sync_at: { [Op.lt]: cutoff } },
        ],
      },
    }
  );
  return affected === 1;
}

/**
 * Filtra los destinatarios que ya fueron notificados de esta entidad con este tipo.
 *
 * 🔴 La marca de "ya avisé" vive en Notifications, NO en el `alert_status` de los modelos (que
 * existe y que el cron ya avanza). Razón: `alert_status` es global por documento, así que si
 * Juan ya fue notificado y después María recibe el permiso, un `alert_status: warned` dejaría a
 * María sin enterarse nunca. La marca correcta es por usuario, y Notifications ya la tiene.
 *
 * `alert_status` no se toca: sigue siendo estado de negocio (computed_status lo usa para
 * "resolved"/"renewed") y del cron.
 */
async function filterAlreadyNotified(userIds, { type, entityType, entityId }) {
  if (userIds.length === 0) return [];
  const existing = await db.Notification.findAll({
    where: { user_id: userIds, type, entity_type: entityType, entity_id: entityId },
    attributes: ["user_id"],
  });
  const notified = new Set(existing.map((n) => n.user_id));
  return userIds.filter((id) => !notified.has(id));
}

async function notifyOnce(userIds, { type, entityType, entityId, title, body, url }) {
  const pending = await filterAlreadyNotified(userIds, { type, entityType, entityId });
  if (pending.length === 0) return 0;
  await notify(pending, {
    type,
    title,
    body,
    url,
    tag: `${entityType}-${entityId}`,
    entity: { type: entityType, id: entityId },
  });
  return pending.length;
}

const formatDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("es-AR");

/**
 * De quién es el documento, para que la notificación sirva de algo: "Carnet de conducir vence el
 * 20/10" no dice nada si hay 50 empleados.
 *
 * `entity_name` NO sirve acá: lo agrega documentController#getAll al serializar, no es un campo
 * del modelo. Se resuelve con un lookup puntual en vez de replicar el mapa de entidades del
 * controller — son pocos documentos (solo los que están por vencer) y el barrido corre una vez
 * por hora como máximo.
 */
async function describeDocumentEntity(doc) {
  if (!doc.entity_id) return null;
  try {
    if (doc.entity_type === "employee") {
      const e = await db.Employee.findByPk(doc.entity_id, { attributes: ["name", "lastname"] });
      return e ? `${e.lastname}, ${e.name}` : null;
    }
    if (doc.entity_type === "vehicle") {
      const v = await db.Vehicle.findByPk(doc.entity_id, { attributes: ["brand", "model", "plate"] });
      return v ? `${v.brand || ""} ${v.model || ""} (${v.plate})`.trim() : null;
    }
  } catch {
    // Si el lookup falla, la notificación sale sin el nombre: mejor un aviso incompleto que
    // ningún aviso.
  }
  return null;
}

async function syncDocuments() {
  const recipients = await resolveUserIdsByPermission("documents_read");
  if (recipients.length === 0) return 0;

  // `computed_status` es un getter VIRTUAL (models/entityDocument.js), así que no se puede
  // filtrar por él en SQL: se acota lo más posible en la query y se termina de filtrar en
  // memoria. Mismo criterio que cronController#checkExpirations. Corre una vez por hora como
  // máximo, así que el costo no importa.
  const documents = await db.EntityDocument.findAll({
    where: {
      expiration_date: { [Op.not]: null },
      alert_status: { [Op.notIn]: ["resolved"] },
    },
  });

  let sent = 0;
  for (const doc of documents) {
    const status = doc.computed_status;
    if (status !== "expiring_soon" && status !== "expired") continue;

    const expired = status === "expired";
    const owner = await describeDocumentEntity(doc);
    sent += await notifyOnce(recipients, {
      // Tipos distintos para los dos estados: es lo que hace que un documento vuelva a avisar
      // cuando pasa de por-vencer a vencido, que es una novedad real.
      type: expired ? "document_expired" : "document_expiring",
      entityType: "entity_document",
      entityId: doc.id,
      title: expired ? "Documento vencido" : "Documento por vencer",
      body: `${doc.title}${owner ? ` — ${owner}` : ""} — ${expired ? "venció" : "vence"} el ${formatDate(doc.expiration_date)}`,
      url: "/dashboard",
    });
  }
  return sent;
}

async function syncSafetyEquipment() {
  // El permiso del AVISO, no el del módulo: varios perfiles entran a EPP para registrar
  // entregas, pero el aviso lo recibe quien gestiona personal (mismo criterio que el tablero).
  const recipients = await resolveUserIdsByPermission("safety_equipment_alerts_read");
  if (recipients.length === 0) return 0;

  const deliveries = await db.SafetyEquipment.findAll({
    where: {
      expiration_date: { [Op.not]: null },
      alert_status: { [Op.notIn]: ["renewed"] },
      return_date: null,
    },
    include: [
      { model: db.Employee, as: "employee", attributes: ["id", "name", "lastname"] },
      { model: db.EppItem, as: "eppItem", attributes: ["id", "name"] },
    ],
  });

  let sent = 0;
  for (const d of deliveries) {
    const status = d.computed_status;
    if (status !== "expiring_soon" && status !== "expired") continue;

    const expired = status === "expired";
    const who = d.employee ? `${d.employee.lastname}, ${d.employee.name}` : `empleado #${d.employee_id}`;
    sent += await notifyOnce(recipients, {
      type: expired ? "epp_expired" : "epp_expiring",
      entityType: "safety_equipment",
      entityId: d.id,
      title: expired ? "EPP vencido" : "EPP por vencer",
      body: `${who} — ${d.eppItem?.name || "EPP"} ${expired ? "venció" : "vence"} el ${formatDate(d.expiration_date)}`,
      url: `/dashboard/safety-equipment?employee_id=${d.employee_id}`,
    });
  }
  return sent;
}

/**
 * NUNCA LANZA, mismo contrato que notify() y sendPushToUsers: se la llama sin await desde un
 * endpoint de lectura, así que un error acá no puede romper la respuesta ni dejarse sin capturar
 * (una promesa rechazada sin handler tumba el proceso en Node moderno).
 */
async function syncExpirationNotifications({ force = false } = {}) {
  const summary = { ran: false, documents: 0, safetyEquipment: 0 };
  try {
    if (!force && !(await claimSyncSlot())) return summary;
    summary.ran = true;

    summary.documents = await syncDocuments();
    summary.safetyEquipment = await syncSafetyEquipment();

    if (summary.documents || summary.safetyEquipment) {
      console.log(
        `[expiration-sync] notificaciones creadas — documentos: ${summary.documents}, EPP: ${summary.safetyEquipment}`
      );
    }
  } catch (error) {
    console.error("[expiration-sync] error inesperado:", error.message);
  }
  return summary;
}

module.exports = { syncExpirationNotifications, THROTTLE_HOURS };
