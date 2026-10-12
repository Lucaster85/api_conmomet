const db = require("../models");
const { isValidAlertType } = require("../helpers/alertTypes");

// Acuse de vista de los avisos del tablero (ver FLOWS.md flujo 36).
//
// Todo acá filtra SIEMPRE por req.user.id del token: el user_id nunca sale del body ni de la
// query. Mismo criterio anti-IDOR que pushSubscriptionController#subscribe — estas rutas viven en
// el namespace /me/*, sin authPermission, así que la única barrera es que cada usuario solo pueda
// tocar sus propias filas.
module.exports = {
  getAll: async (req, res) => {
    try {
      const where = { user_id: req.user.id };

      if (req.query.alert_type) {
        if (!isValidAlertType(req.query.alert_type)) {
          return res.status(400).json({ error: "Tipo de aviso inválido." });
        }
        where.alert_type = req.query.alert_type;
      }

      // Sin paginar a propósito: son las vistas de los pendientes de UN usuario (decenas), y el
      // tablero las necesita todas de una para decidir qué items ocultar.
      const views = await db.UserAlertView.findAll({
        where,
        attributes: ["alert_type", "entity_id", "revision", "seen_at"],
      });

      return res.status(200).json({ data: views });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // Body: { alert_type, items: [{ entity_id, revision }] }
  // Misma forma para un item suelto y para "marcar todos como vistos" — un solo endpoint.
  markSeen: async (req, res) => {
    try {
      const { alert_type: alertType, items } = req.body;

      if (!isValidAlertType(alertType)) {
        return res.status(400).json({ error: "Tipo de aviso inválido." });
      }
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "Se requiere al menos un item." });
      }

      const rows = [];
      for (const item of items) {
        const entityId = Number(item && item.entity_id);
        if (!Number.isInteger(entityId) || entityId <= 0) {
          return res.status(400).json({ error: "entity_id inválido." });
        }
        // La revisión es opaca para el backend, pero la columna es STRING(80): un valor más largo
        // truncaría en silencio y el item quedaría reapareciendo para siempre (la revisión
        // guardada nunca volvería a coincidir con la calculada).
        const revision = String(item.revision ?? "");
        if (revision.length === 0 || revision.length > 80) {
          return res.status(400).json({ error: "revision inválida." });
        }
        rows.push({
          user_id: req.user.id,
          alert_type: alertType,
          entity_id: entityId,
          revision,
          seen_at: new Date(),
        });
      }

      await db.UserAlertView.bulkCreate(rows, {
        updateOnDuplicate: ["revision", "seen_at", "updated_at"],
      });

      return res.status(200).json({ data: { marked: rows.length } });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // Body: { alert_type } — "volver a mostrar todo" de ese aviso.
  reset: async (req, res) => {
    try {
      const alertType = req.body.alert_type;

      if (!isValidAlertType(alertType)) {
        return res.status(400).json({ error: "Tipo de aviso inválido." });
      }

      const deleted = await db.UserAlertView.destroy({
        where: { user_id: req.user.id, alert_type: alertType },
      });

      return res.status(200).json({ data: { deleted } });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
