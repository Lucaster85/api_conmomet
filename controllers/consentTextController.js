const { sendServerError } = require("../helpers/httpErrors");
const db = require("../models");

/**
 * Texto de privacidad de "Trabajá con nosotros" (ver FLOWS.md §63).
 *
 * Es un registro de SOLO AGREGAR: no hay edición ni baja de una versión, publicar un cambio crea la
 * siguiente. Si una versión se pudiera pisar o borrar, `Candidate.consent_version` dejaría de decir qué
 * leyó y aceptó cada postulante.
 */

const KIND = "job_application";
const MAX_LENGTH = 20000;

const userAttrs = ["id", "name", "lastname"];

const latest = () => db.ConsentText.findOne({ where: { kind: KIND }, order: [["version", "DESC"]] });

// El texto de una versión concreta, o null. Lo usa el formulario público para validar la versión que la
// persona vio al aceptar.
const findVersion = (version) => db.ConsentText.findOne({ where: { kind: KIND, version } });

const serialize = (row) => ({
  id: row.id,
  version: row.version,
  content: row.content,
  // Sequelize `underscored` deja los timestamps automáticos en camelCase; se normaliza acá.
  created_at: row.created_at || row.createdAt,
  created_by: row.createdByUser ? { id: row.createdByUser.id, name: row.createdByUser.name, lastname: row.createdByUser.lastname } : null,
});

module.exports = {
  findVersion,
  latest,

  // GET /public/job-applications/privacy — sin sesión: lo lee la página pública para mostrar el texto
  // vigente y la versión que después se manda al enviar. Solo la versión actual, nunca el historial.
  publicCurrent: async (req, res) => {
    try {
      const current = await latest();
      if (!current) return res.status(404).json({ error: "El texto de privacidad no está disponible." });
      return res.status(200).json({ data: { version: current.version, content: current.content } });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  // GET /system-settings/privacy-texts — el historial completo, la más nueva primero (system_settings_update).
  list: async (req, res) => {
    try {
      const rows = await db.ConsentText.findAll({
        where: { kind: KIND },
        include: [{ model: db.User, as: "createdByUser", attributes: userAttrs }],
        order: [["version", "DESC"]],
      });
      return res.status(200).json({ data: rows.map(serialize) });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  // POST /system-settings/privacy-texts — publica una versión nueva con `content` (system_settings_update).
  // Rechaza un texto igual al vigente: crear una versión idéntica solo ensuciaría el historial.
  create: async (req, res) => {
    try {
      const content = String(req.body?.content ?? "").replace(/\r\n/g, "\n").trim();
      if (!content) return res.status(400).json({ error: "El texto no puede estar vacío." });
      if (content.length > MAX_LENGTH) return res.status(400).json({ error: `El texto puede tener hasta ${MAX_LENGTH} caracteres.` });

      const transaction = await db.sequelize.transaction();
      try {
        // FOR UPDATE sobre la última versión: dos publicaciones simultáneas no pueden tomar el mismo número.
        const current = await db.ConsentText.findOne({ where: { kind: KIND }, order: [["version", "DESC"]], transaction, lock: transaction.LOCK.UPDATE });
        if (current && current.content.trim() === content) {
          await transaction.rollback();
          return res.status(400).json({ error: "El texto es igual al vigente: no hay nada que publicar." });
        }
        const created = await db.ConsentText.create(
          { kind: KIND, version: (current ? current.version : 0) + 1, content, created_by: req.user.id },
          { transaction }
        );
        await transaction.commit();
        const full = await db.ConsentText.findByPk(created.id, { include: [{ model: db.User, as: "createdByUser", attributes: userAttrs }] });
        return res.status(201).json({ data: serialize(full) });
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    } catch (error) {
      return sendServerError(res, error);
    }
  },
};
