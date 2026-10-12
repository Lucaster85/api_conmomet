const db = require("../models");
const { sendPushToUsers } = require("./pushService");
const { isValidNotificationType } = require("./notificationTypes");

/**
 * El punto único por donde se avisa algo a alguien (ver FLOWS.md flujo 37).
 *
 * Hace las DOS cosas: persiste una fila en `Notifications` por destinatario (el historial que la
 * campanita consulta) y manda el push (el aviso inmediato al celular). Antes de este flujo los
 * módulos llamaban a `sendPushToUsers` directo, y lo que no llegaba no dejaba rastro.
 *
 * Misma firma que `sendPushToUsers` más `type` y `entity`, así migrar un disparador existente es
 * cambiar el nombre de la función y agregar dos campos — sin tocar la lógica de destinatarios,
 * que es la parte difícil y ya está resuelta y documentada en el flujo 28.
 *
 * Igual que `sendPushToUsers`: **NUNCA LANZA**. Un aviso caído no puede romper una operación de
 * negocio. Y es fire-and-forget — quien la llama no la espera.
 *
 * Orden deliberado: primero el INSERT, después el push. El historial es lo consultable y
 * recuperable; el push es best-effort. Si algo va a fallar, que falle lo que se puede ver después.
 */
async function notify(userIds, { type, title, body, url, tag, entity, excludeUserId } = {}) {
  const summary = { recipients: 0, persisted: 0, push: null };
  try {
    if (!isValidNotificationType(type)) {
      // No se corta el aviso por esto: es un bug de programación, no una condición de runtime, y
      // dejar al usuario sin push por un tipo mal escrito sería peor. Se loguea fuerte y sigue.
      console.error(
        `[notify] tipo de notificación desconocido "${type}" — se envía el push igual, pero la fila ` +
        `no va a tener ícono en la campanita. Agregalo a helpers/notificationTypes.js.`
      );
    }

    // Mismo dedupe + exclusión del actor que sendPushToUsers, aplicado ANTES del insert: si no,
    // el que hace la acción se auto-notifica y la campanita le suena por su propio click.
    const uniqueUserIds = [...new Set((userIds || []).map(Number))].filter(
      (id) => Number.isInteger(id) && id !== Number(excludeUserId)
    );
    summary.recipients = uniqueUserIds.length;

    if (uniqueUserIds.length === 0) {
      console.log(`[notify] "${title}": sin destinatarios tras excluir al actor (${excludeUserId}) — no se persiste ni se envía nada`);
      return summary;
    }

    if (!title) {
      console.error("[notify] se llamó sin title — se descarta el aviso");
      return summary;
    }

    try {
      const rows = uniqueUserIds.map((userId) => ({
        user_id: userId,
        type: String(type || "").slice(0, 40),
        title: String(title).slice(0, 120),
        body: body ? String(body).slice(0, 500) : null,
        url: url ? String(url).slice(0, 255) : null,
        entity_type: entity && entity.type ? String(entity.type).slice(0, 40) : null,
        entity_id: entity && Number.isInteger(Number(entity.id)) ? Number(entity.id) : null,
        created_by: Number.isInteger(Number(excludeUserId)) ? Number(excludeUserId) : null,
      }));
      const created = await db.Notification.bulkCreate(rows);
      summary.persisted = created.length;
    } catch (error) {
      // El push se intenta igual: perder el historial es malo, perder las dos cosas es peor.
      console.error(`[notify] no se pudo persistir "${title}":`, error.message);
    }

    // El push trunca title/body por su cuenta (tope ~4KB del payload cifrado). La fila guardada
    // conserva el texto completo, así que la campanita puede mostrar más que el celular.
    summary.push = await sendPushToUsers(uniqueUserIds, { title, body, url, tag, excludeUserId });
  } catch (error) {
    // Última red de seguridad: pase lo que pase, notify nunca propaga.
    console.error("[notify] error inesperado:", error.message);
  }
  return summary;
}

/**
 * Poda de notificaciones viejas de UN usuario. Se llama oportunistamente desde el listado.
 *
 * Por qué acá y no en un cron: `POST /cron/check-expirations` existe pero **no tiene ningún
 * scheduler configurado que le pegue** (ver flujo 36), así que un cron de poda no correría nunca
 * y la tabla crecería sin techo. Podar las del propio usuario al listar es una query indexada por
 * (user_id, created_at), cuesta milisegundos, y mantiene la tabla acotada sin infraestructura
 * nueva. No bloquea la respuesta: quien la llama no la espera.
 */
const RETENTION_DAYS = 90;

async function pruneOldNotifications(userId) {
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await db.Notification.destroy({
      where: { user_id: userId, created_at: { [db.Sequelize.Op.lt]: cutoff } },
    });
  } catch (error) {
    console.error(`[notify] falló la poda de notificaciones del usuario ${userId}:`, error.message);
  }
}

module.exports = { notify, pruneOldNotifications, RETENTION_DAYS };
