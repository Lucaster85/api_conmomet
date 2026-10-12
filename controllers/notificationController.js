const db = require("../models");
const { Op } = require("sequelize");
const { pruneOldNotifications } = require("../helpers/notificationService");
const { syncExpirationNotifications } = require("../services/expirationNotifier");

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/**
 * `underscored: true` hace que la COLUMNA sea `created_at`, pero el ATRIBUTO del modelo sigue
 * siendo `createdAt` — Sequelize solo renombra la columna. Sin esta normalización el JSON sale
 * con `createdAt` y el frontend, que consume snake_case en todo el resto del payload, lee
 * `created_at` → `undefined` → `new Date(undefined)` → **"Invalid Date"** en la campanita.
 *
 * Mismo criterio que additionalController.js:129, que ya resolvía esto igual. No se renombra el
 * atributo en el modelo a propósito: hay varias queries en el repo que usan `createdAt` como
 * atributo (`order: [["createdAt", "DESC"]]`, `attributes: [... "createdAt"]`) y cambiarlo las
 * rompería.
 */
function serializeNotification(n) {
  const plain = n.toJSON();
  return {
    ...plain,
    created_at: plain.created_at || plain.createdAt,
    updated_at: plain.updated_at || plain.updatedAt,
  };
}

// La campanita del header (ver FLOWS.md flujo 37).
//
// Todo filtra SIEMPRE por req.user.id del token. Las rutas viven en /me/*, sin authPermission:
// las notificaciones de un usuario son suyas, no hay nada que gatear por rol — y el permiso que
// authPermission derivaría (`me_read`) no existe.
module.exports = {
  /**
   * Feed paginado por cursor. `before` es el id de la última fila ya mostrada: paginar por id
   * descendente (y no por offset) evita que una notificación nueva que entra mientras el usuario
   * scrollea le corra las páginas y le repita filas.
   */
  getAll: async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || DEFAULT_LIMIT, MAX_LIMIT);
      const where = { user_id: req.user.id };

      if (req.query.unread_only === "true") where.read_at = null;
      if (req.query.before) {
        const before = Number(req.query.before);
        if (!Number.isInteger(before)) return res.status(400).json({ error: "Cursor inválido." });
        where.id = { [Op.lt]: before };
      }

      // Se pide uno más que el límite para saber si hay página siguiente sin hacer un COUNT
      // aparte sobre toda la tabla.
      const rows = await db.Notification.findAll({
        where,
        order: [["id", "DESC"]],
        limit: limit + 1,
      });

      const hasMore = rows.length > limit;
      const data = hasMore ? rows.slice(0, limit) : rows;

      // El contador va siempre, sobre TODAS las no leídas: es lo que pinta el badge, y tiene que
      // ser independiente de la página o del filtro que se esté mirando.
      const unreadCount = await db.Notification.count({
        where: { user_id: req.user.id, read_at: null },
      });

      // Oportunista y sin await: no retrasa la respuesta ni la hace fallar si la poda falla.
      pruneOldNotifications(req.user.id);

      return res.status(200).json({
        data: data.map(serializeNotification),
        unread_count: unreadCount,
        has_more: hasMore,
        next_cursor: hasMore ? data[data.length - 1].id : null,
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // Endpoint aparte y barato para el badge: corre en cada carga de la app y en cada vuelta al
  // foco de la pestaña, y no necesita traer ninguna fila.
  unreadCount: async (req, res) => {
    try {
      // Acá se engancha el barrido de los avisos que dependen del calendario (FLOWS.md flujo 38):
      // este endpoint es el latido natural de la campanita, así que es el punto donde "alguien
      // entró a la app" se traduce en "revisá si hay vencimientos nuevos". Sin await y sin poder
      // lanzar: su propio throttle corta el 99% de las llamadas con un solo UPDATE que no afecta
      // filas, así que el costo normal es despreciable.
      syncExpirationNotifications();

      const count = await db.Notification.count({
        where: { user_id: req.user.id, read_at: null },
      });
      return res.status(200).json({ data: { unread_count: count } });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  markRead: async (req, res) => {
    try {
      // El user_id va en el WHERE, no se chequea después de traer la fila: así un id ajeno
      // devuelve 404 sin filtrar siquiera la existencia de la notificación de otra persona.
      const [updated] = await db.Notification.update(
        { read_at: new Date() },
        { where: { id: req.params.id, user_id: req.user.id, read_at: null } }
      );

      if (updated === 0) {
        // Puede ser que no exista, que sea de otro usuario, o que ya estuviera leída. Las tres
        // son idempotentes desde la vista del cliente, así que se responde OK con el contador
        // actualizado en vez de un 404 que la UI tendría que distinguir de un error real.
        const exists = await db.Notification.count({ where: { id: req.params.id, user_id: req.user.id } });
        if (exists === 0) return res.status(404).json({ error: "Notificación no encontrada." });
      }

      const unreadCount = await db.Notification.count({
        where: { user_id: req.user.id, read_at: null },
      });
      return res.status(200).json({ data: { unread_count: unreadCount } });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  markAllRead: async (req, res) => {
    try {
      const [updated] = await db.Notification.update(
        { read_at: new Date() },
        { where: { user_id: req.user.id, read_at: null } }
      );
      return res.status(200).json({ data: { marked: updated, unread_count: 0 } });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
