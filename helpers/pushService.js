const webpush = require("web-push");
const db = require("../models");
const { userHasPermission } = require("./permissions");

// Falla RUIDOSAMENTE si faltan las claves — la alternativa (dejar que el endpoint de la
// pública devuelva "") produce un InvalidCharacterError críptico en el browser al hacer
// atob() sobre un string vacío, bien lejos de la causa real (ver FLOWS.md flujo 28).
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.error(
    "[push] Faltan VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT en el entorno — " +
    "el envío de notificaciones push está deshabilitado hasta que se configuren."
  );
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

// Tope real del payload cifrado es ~4096 bytes (RFC 8291); se recorta bien por debajo para
// dejar margen al resto del JSON (url, tag, icon) sin acercarse al límite.
function truncate(str, max) {
  if (!str) return str;
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

/**
 * La pieza transversal: cualquier módulo de la app notifica llamando a esto. NUNCA lanza — un
 * push caído no puede romper una operación de negocio — y es fire-and-forget: sin reintentos ni
 * garantía de entrega (ver FLOWS.md flujo 28).
 *
 * - Dedupe + excludeUserId ANTES de consultar la base.
 * - Poda suscripciones muertas ante 404/410 (ya no existen) y 403 (p. ej. se rotaron las claves
 *   VAPID — sin podar por 403 quedaría logueando el mismo error para siempre).
 * - TTL ~1 día: que un celular apagado una semana no reciba un aviso ya viejo al prenderse.
 */
async function sendPushToUsers(userIds, { title, body, url, tag, excludeUserId } = {}) {
  try {
    const uniqueUserIds = [...new Set(userIds || [])].filter((id) => id !== excludeUserId);
    if (uniqueUserIds.length === 0) return;

    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
      console.error(`[push] sin claves VAPID configuradas — se descarta el envío a [${uniqueUserIds.join(", ")}]`);
      return;
    }

    const subscriptions = await db.PushSubscription.findAll({ where: { user_id: uniqueUserIds } });
    if (subscriptions.length === 0) return;

    const payload = JSON.stringify({
      title: truncate(title, 60) || "Conmomet",
      body: truncate(body, 150) || "Tenés una novedad",
      url: url || "/dashboard",
      tag: tag || undefined,
    });

    const results = await Promise.allSettled(
      subscriptions.map((sub) =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { TTL: 86400 }
        ).then(
          () => sub.update({ last_success_at: new Date() }),
          (err) => {
            const status = err && err.statusCode;
            // 404/410: el browser dio de baja la suscripción. 403: credenciales VAPID
            // rechazadas (p. ej. se rotaron las claves) — también muerta para siempre.
            if (status === 404 || status === 410 || status === 403) {
              return sub.destroy();
            }
            console.error(`[push] fallo enviando a subscription ${sub.id} (status ${status}):`, err.message);
          }
        )
      )
    );

    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) {
      console.error(`[push] ${failed}/${subscriptions.length} envíos fallaron de forma inesperada`);
    }
  } catch (error) {
    // Última red de seguridad: pase lo que pase, sendPushToUsers nunca propaga.
    console.error("[push] error inesperado en sendPushToUsers:", error.message);
  }
}

module.exports = { resolveUserIdsByPermission, sendPushToUsers };
