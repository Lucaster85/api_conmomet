const db = require("../models");
const { isValidQuickNoteEntityType } = require("../helpers/quickNoteEntityTypes");
const { todayInArgentina } = require("../helpers/argentinaDate");

// Notas rápidas personales (ver FLOWS.md, flujo de Notas rápidas).
//
// Todo acá filtra SIEMPRE por req.user.id del token: el user_id nunca sale del body ni de la query.
// Mismo criterio anti-IDOR que userAlertViewController y pushSubscriptionController — estas rutas
// viven en /me/*, sin authPermission, así que la única barrera es que cada usuario solo pueda tocar
// sus propias filas. Una nota ajena responde 404 (no 403): no se confirma que exista.

const MAX_CONTENT_LENGTH = 2000;
const COMPLETED_LIMIT = 50;

/**
 * `underscored: true` deja la COLUMNA en `created_at` pero el ATRIBUTO en `createdAt`: sin esta
 * normalización el JSON saldría camelCase y el frontend, que consume snake_case, leería
 * `undefined` (mismo problema y misma solución que notificationController#serializeNotification).
 *
 * `entity` es siempre null por ahora. El día que se habilite el vínculo pasa a ser
 * `{ type, id, label, url }` — los componentes del frontend ya lo tipan así.
 */
function serialize(note) {
  const plain = note.toJSON();
  return {
    id: plain.id,
    content: plain.content,
    due_date: plain.due_date || null,
    completed_at: plain.completed_at || null,
    entity: null,
    created_at: plain.created_at || plain.createdAt,
    updated_at: plain.updated_at || plain.updatedAt,
  };
}

/** ¿El vencimiento es hoy o ya pasó (en fecha de Argentina)? null = sin vencimiento. */
function isDueByToday(dueDate) {
  return !!dueDate && dueDate <= todayInArgentina();
}

function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** @returns {{ value: string } | { error: string }} */
function parseContent(raw) {
  if (typeof raw !== "string") return { error: "El texto de la nota es obligatorio." };
  const value = raw.trim();
  if (value.length === 0) return { error: "El texto de la nota es obligatorio." };
  if (value.length > MAX_CONTENT_LENGTH) {
    return { error: `La nota no puede superar los ${MAX_CONTENT_LENGTH} caracteres.` };
  }
  return { value };
}

/** @returns {{ value: string|null } | { error: string }} — null/'' limpian el vencimiento. */
function parseDueDate(raw) {
  if (raw === null || raw === "") return { value: null };
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return { error: "El vencimiento debe tener formato AAAA-MM-DD." };
  }
  // Rechaza fechas que el regex deja pasar pero no existen (2026-02-31): Date las "corrige" al mes
  // siguiente, así que se compara el round-trip.
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) {
    return { error: "El vencimiento no es una fecha válida." };
  }
  return { value: raw };
}

/**
 * El vínculo a una entidad está PREPARADO pero NO HABILITADO (ver helpers/quickNoteEntityTypes.js).
 * Los dos campos van juntos o ninguno; si llegan, el tipo tiene que estar en la lista blanca. Como
 * hoy está vacía, cualquier vínculo se rechaza.
 *
 * @returns {string|null} mensaje de error, o null si no se envió ningún vínculo.
 */
function validateEntityLink(body) {
  const hasType = body.entity_type !== undefined && body.entity_type !== null;
  const hasId = body.entity_id !== undefined && body.entity_id !== null;
  if (!hasType && !hasId) return null;
  if (hasType !== hasId) return "entity_type y entity_id van juntos.";
  if (!isValidQuickNoteEntityType(body.entity_type)) {
    return "Todavía no se pueden vincular notas a ese tipo de registro.";
  }
  return null;
}

async function findOwned(req, options = {}) {
  const id = parseId(req.params.id);
  if (!id) return null;
  return db.QuickNote.findOne({ where: { id, user_id: req.user.id }, ...options });
}

module.exports = {
  // { pending, completed }. Sin paginar: son las notas de UN usuario.
  getAll: async (req, res) => {
    try {
      const pending = await db.QuickNote.findAll({
        where: { user_id: req.user.id, completed_at: null },
        // Primero las que tienen vencimiento (la más próxima arriba), después las sueltas, de la más
        // nueva a la más vieja.
        order: [
          [db.sequelize.literal("due_date IS NULL"), "ASC"],
          ["due_date", "ASC"],
          ["createdAt", "DESC"],
        ],
      });
      const completed = await db.QuickNote.findAll({
        where: { user_id: req.user.id, completed_at: { [db.Sequelize.Op.not]: null } },
        order: [["completed_at", "DESC"]],
        limit: COMPLETED_LIMIT,
      });

      return res.status(200).json({
        pending: pending.map(serialize),
        completed: completed.map(serialize),
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // Body: { content, due_date? }
  create: async (req, res) => {
    try {
      const content = parseContent(req.body.content);
      if (content.error) return res.status(400).json({ error: content.error });

      let dueDate = null;
      if (req.body.due_date !== undefined) {
        const parsed = parseDueDate(req.body.due_date);
        if (parsed.error) return res.status(400).json({ error: parsed.error });
        dueDate = parsed.value;
      }

      const linkError = validateEntityLink(req.body);
      if (linkError) return res.status(400).json({ error: linkError });

      const note = await db.QuickNote.create({
        user_id: req.user.id,
        content: content.value,
        due_date: dueDate,
        due_notified_at: isDueByToday(dueDate) ? new Date() : null,
      });
      return res.status(201).json({ data: serialize(note) });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // Body: { content?, due_date?, completed? } — un solo endpoint para editar, completar y reabrir.
  update: async (req, res) => {
    try {
      if (!parseId(req.params.id)) return res.status(400).json({ error: "id inválido." });
      const note = await findOwned(req);
      if (!note) return res.status(404).json({ error: "Nota no encontrada." });

      const changes = {};

      if (req.body.content !== undefined) {
        const content = parseContent(req.body.content);
        if (content.error) return res.status(400).json({ error: content.error });
        changes.content = content.value;
      }

      if (req.body.due_date !== undefined) {
        const parsed = parseDueDate(req.body.due_date);
        if (parsed.error) return res.status(400).json({ error: parsed.error });
        changes.due_date = parsed.value;
      }

      if (req.body.completed !== undefined) {
        if (typeof req.body.completed !== "boolean") {
          return res.status(400).json({ error: "completed debe ser true o false." });
        }
        if (req.body.completed) {
          // Completar una nota ya completada no pisa la fecha original.
          if (!note.completed_at) changes.completed_at = new Date();
        } else {
          changes.completed_at = null;
        }
      }

      const linkError = validateEntityLink(req.body);
      if (linkError) return res.status(400).json({ error: linkError });

      // Marca de "ya avisé el vencimiento" (etapa 3, ver FLOWS.md §48):
      // - Si el vencimiento CAMBIA, se reinicia: la nota puede avisar de nuevo en la fecha nueva. Salvo
      //   que la fecha nueva ya sea hoy o pasada: el usuario recién la escribió, avisarle una hora
      //   después (cuando corra el barrido) sería ruido, así que nace como "ya avisada".
      // - Si se REABRE una nota cuyo vencimiento ya pasó y nunca llegó a avisar (la completó antes del
      //   barrido), lo mismo: la reabrió a propósito, no hace falta avisarle que está vencida.
      const newDue = changes.due_date !== undefined ? changes.due_date : note.due_date;
      if (changes.due_date !== undefined && changes.due_date !== note.due_date) {
        changes.due_notified_at = isDueByToday(newDue) ? new Date() : null;
      } else if (req.body.completed === false && note.completed_at && !note.due_notified_at && isDueByToday(newDue)) {
        changes.due_notified_at = new Date();
      }

      const sentAnyField =
        req.body.content !== undefined || req.body.due_date !== undefined || req.body.completed !== undefined;
      if (!sentAnyField) {
        return res.status(400).json({ error: "No hay nada para actualizar." });
      }

      // Se envió algo válido pero no cambia nada (ej. completar una nota ya completada, por un
      // doble toque): es un no-op idempotente, no un error.
      if (Object.keys(changes).length > 0) await note.update(changes);
      return res.status(200).json({ data: serialize(note) });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // Soft delete: la UI no pide confirmación, ofrece "Deshacer" (restore).
  remove: async (req, res) => {
    try {
      if (!parseId(req.params.id)) return res.status(400).json({ error: "id inválido." });
      const note = await findOwned(req);
      if (!note) return res.status(404).json({ error: "Nota no encontrada." });

      await note.destroy();
      return res.status(200).json({ data: { id: note.id } });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // El "Deshacer" de eliminar. Idempotente: restaurar una nota que no está eliminada la devuelve tal cual.
  restore: async (req, res) => {
    try {
      if (!parseId(req.params.id)) return res.status(400).json({ error: "id inválido." });
      const note = await findOwned(req, { paranoid: false });
      if (!note) return res.status(404).json({ error: "Nota no encontrada." });

      if (note.deletedAt) await note.restore();
      return res.status(200).json({ data: serialize(note) });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
