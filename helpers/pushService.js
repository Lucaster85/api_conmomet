const webpush = require("web-push");
const db = require("../models");
const { userHasPermission } = require("./permissions");

// Falla RUIDOSAMENTE si faltan las claves — la alternativa (dejar que el endpoint de la
// pública devuelva "") produce un InvalidCharacterError críptico en el browser al hacer
// atob() sobre un string vacío, bien lejos de la causa real (ver FLOWS.md flujo 28).
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT;

const vapidConfigured = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT);

if (vapidConfigured) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.error(
    "[push] Faltan VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT en el entorno — " +
    "el envío de notificaciones push está deshabilitado hasta que se configuren."
  );
}

function isVapidConfigured() {
  return vapidConfigured;
}

/**
 * Todos los usuarios (activos — Sequelize excluye soft-deleted por default al ser paranoid)
 * que tengan el permiso dado, ya sea por su rol o asignado directamente. Mismo criterio que
 * userHasPermission (admin_granted es comodín) — se reusa esa función en vez de reimplementar
 * la unión de permisos en SQL, para no tener dos lugares que puedan desincronizarse.
 */
async function resolveUserIdsByPermission(permissionName) {
  const users = await db.User.findAll({
    include: [
      { model: db.Role, as: "role", include: [{ model: db.Permission, as: "permissions" }] },
      { model: db.Permission, as: "permissions" },
    ],
  });
  return users.filter((u) => userHasPermission(u, permissionName)).map((u) => u.id);
}

// El endpoint siempre debería ser una URL válida, pero esto se usa dentro de un catch: si
// tirara, se perdería el resultado de TODOS los envíos del lote.
function pushServiceHost(endpoint) {
  try {
    return new URL(endpoint).host;
  } catch {
    return "el servicio de push";
  }
}

// Tope real del payload cifrado es ~4096 bytes (RFC 8291); se recorta bien por debajo para
// dejar margen al resto del JSON (url, tag, icon) sin acercarse al límite.
function truncate(str, max) {
  if (!str) return str;
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

/**
 * Envía a una lista de suscripciones ya resuelta y devuelve el detalle de cada intento.
 * Separado de sendPushToUsers para que el endpoint de prueba (/me/push-subscriptions/test)
 * pueda mostrarle al usuario el error REAL del servicio de push en vez de un "no llegó".
 *
 * Política de poda — la diferencia importa y es la que nos mordió en staging:
 * - 404 / 410: el browser dio de baja esa suscripción. Está muerta para siempre → se borra.
 * - 403 / 401: el servicio de push RECHAZÓ NUESTRAS CREDENCIALES VAPID. Eso es un problema de
 *   configuración del servidor (claves mal cargadas, cambiadas, o par público/privado que no
 *   se corresponde), NO una suscripción muerta. Borrarlas acá vacía la tabla entera al primer
 *   envío y deja a todos los dispositivos creyendo que siguen activos, sin ningún error
 *   visible. Se conserva la fila y se loguea fuerte.
 */
async function sendToSubscriptions(subscriptions, payload) {
  const results = await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { TTL: 86400 }
        );
        await sub.update({ last_success_at: new Date() });
        return { id: sub.id, ok: true };
      } catch (err) {
        const status = err && err.statusCode;
        const detail = (err && (err.body || err.message) || "").toString().slice(0, 300);

        if (status === 404 || status === 410) {
          console.warn(`[push] suscripción ${sub.id} dada de baja por el browser (status ${status}) — se elimina`);
          await sub.destroy().catch(() => undefined);
          return { id: sub.id, ok: false, status, pruned: true, detail };
        }

        if (status === 403 || status === 401) {
          console.error(
            `[push] CREDENCIALES VAPID RECHAZADAS (status ${status}) por ${pushServiceHost(sub.endpoint)}. ` +
            `NO es una suscripción muerta: revisá que VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY de este entorno ` +
            `sean el MISMO PAR con el que se suscribieron los dispositivos, y que VAPID_SUBJECT sea un ` +
            `mailto: o https: válido. La suscripción ${sub.id} se conserva. Detalle: ${detail}`
          );
          return { id: sub.id, ok: false, status, pruned: false, detail };
        }

        console.error(`[push] fallo enviando a suscripción ${sub.id} (status ${status}): ${detail}`);
        return { id: sub.id, ok: false, status, pruned: false, detail };
      }
    })
  );
  return results;
}

/**
 * La pieza transversal: cualquier módulo de la app notifica llamando a esto. NUNCA lanza — un
 * push caído no puede romper una operación de negocio — y es fire-and-forget: sin reintentos ni
 * garantía de entrega (ver FLOWS.md flujo 28).
 *
 * Devuelve un resumen (útil para el endpoint de prueba y para los logs); quien la llama en el
 * flujo normal lo ignora y ni siquiera la espera.
 */
async function sendPushToUsers(userIds, { title, body, url, tag, excludeUserId } = {}) {
  const summary = { recipients: 0, subscriptions: 0, sent: 0, results: [] };
  try {
    const uniqueUserIds = [...new Set((userIds || []).map(Number))].filter(
      (id) => Number.isInteger(id) && id !== Number(excludeUserId)
    );
    summary.recipients = uniqueUserIds.length;
    if (uniqueUserIds.length === 0) {
      console.log(`[push] "${title}": sin destinatarios tras excluir al actor (${excludeUserId}) — no se envía nada`);
      return summary;
    }

    if (!vapidConfigured) {
      console.error(`[push] sin claves VAPID configuradas — se descarta el envío a [${uniqueUserIds.join(", ")}]`);
      return summary;
    }

    const subscriptions = await db.PushSubscription.findAll({ where: { user_id: uniqueUserIds } });
    summary.subscriptions = subscriptions.length;
    if (subscriptions.length === 0) {
      console.log(
        `[push] "${title}": destinatarios [${uniqueUserIds.join(", ")}] no tienen ningún dispositivo ` +
        `suscripto — no se envía nada`
      );
      return summary;
    }

    const payload = JSON.stringify({
      title: truncate(title, 60) || "Conmomet",
      body: truncate(body, 150) || "Tenés una novedad",
      url: url || "/dashboard",
      tag: tag || undefined,
    });

    summary.results = await sendToSubscriptions(subscriptions, payload);
    summary.sent = summary.results.filter((r) => r.ok).length;
    console.log(
      `[push] "${title}": destinatarios [${uniqueUserIds.join(", ")}], ` +
      `${summary.sent}/${subscriptions.length} envíos OK`
    );
  } catch (error) {
    // Última red de seguridad: pase lo que pase, sendPushToUsers nunca propaga.
    console.error("[push] error inesperado en sendPushToUsers:", error.message);
  }
  return summary;
}

module.exports = { resolveUserIdsByPermission, sendPushToUsers, sendToSubscriptions, isVapidConfigured };
