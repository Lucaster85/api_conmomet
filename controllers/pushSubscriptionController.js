const db = require("../models");

module.exports = {
  // Pública — la clave privada vive solo acá, nunca en el frontend (ver FLOWS.md flujo 28:
  // se descartó pasarla por window.__ENV__ para no tener el par partido entre dos servicios
  // de Railway).
  getVapidPublicKey: async (req, res) => {
    if (!process.env.VAPID_PUBLIC_KEY) {
      return res.status(503).json({ error: "El servicio de notificaciones push no está configurado." });
    }
    return res.status(200).json({ publicKey: process.env.VAPID_PUBLIC_KEY });
  },

  // Upsert por `endpoint`. SIEMPRE usa req.user.id, nunca un user_id que venga del body — si no,
  // cualquier usuario autenticado podría re-apuntar la suscripción de otro (IDOR). El upsert
  // SOBRESCRIBE user_id en vez de ignorar un endpoint ya existente: "el último que se autenticó
  // en este dispositivo es el dueño" — es la pieza que cierra el problema del celular
  // compartido (ver FLOWS.md flujo 28, §4 del plan).
  subscribe: async (req, res) => {
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
      return res.status(400).json({ error: "Suscripción inválida." });
    }

    const userAgent = (req.headers["user-agent"] || "").slice(0, 512);

    try {
      const [subscription] = await db.PushSubscription.upsert(
        {
          endpoint,
          user_id: req.user.id,
          p256dh: keys.p256dh,
          auth: keys.auth,
          user_agent: userAgent,
        },
        { returning: true }
      );
      return res.status(200).json({ data: { id: subscription.id } });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // Baja explícita (logout). No es DELETE con body a propósito: algunos intermediarios
  // descartan el body de un DELETE, y el endpoint tiene "/" así que no entra limpio en un path
  // ni conviene en query string (morgan lo loguearía completo).
  unsubscribe: async (req, res) => {
    const { endpoint } = req.body || {};
    if (!endpoint) return res.status(400).json({ error: "Falta el endpoint." });

    try {
      await db.PushSubscription.destroy({ where: { endpoint, user_id: req.user.id } });
      return res.status(204).send();
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // Pública, a propósito — capa 2 de la reconciliación de `pushsubscriptionchange` (ver FLOWS.md
  // flujo 28, §3.6). El service worker no tiene JWT cuando el browser rota el endpoint, así que
  // no puede autenticarse. El propio endpoint viejo es la prueba de identidad: es una URL de
  // alta entropía que solo conocían ese browser y este servidor. Por eso:
  // - SOLO actualiza una fila existente, nunca crea una nueva (no sirve para registrar un
  //   dispositivo nuevo sin login).
  // - Nunca devuelve datos del usuario.
  // - 204 tanto si lo encontró como si no, para no filtrar si un endpoint existe o no.
  rotate: async (req, res) => {
    const { old_endpoint, new_subscription } = req.body || {};
    if (!old_endpoint || !new_subscription || !new_subscription.endpoint || !new_subscription.keys) {
      return res.status(204).send();
    }

    try {
      const existing = await db.PushSubscription.findOne({ where: { endpoint: old_endpoint } });
      if (!existing) return res.status(204).send();

      await existing.update({
        endpoint: new_subscription.endpoint,
        p256dh: new_subscription.keys.p256dh,
        auth: new_subscription.keys.auth,
      });
      return res.status(204).send();
    } catch {
      // Nunca filtrar detalle del error acá — es una ruta pública.
      return res.status(204).send();
    }
  },
};
