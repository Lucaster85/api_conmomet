const db = require("../models");
const { uploadToR2, deleteFromR2 } = require("../helpers");

/**
 * Seguimiento de un proyecto/adicional (/project-logs/:projectId): notas de seguimiento con fecha,
 * autor y fotos opcionales, para que quien lo encarga vaya dejando "se compró material para tal
 * cosa", "se hizo tal trabajo". Es un registro de SOLO AGREGAR: no hay edición ni borrado — una
 * nota equivocada se corrige con otra nueva. La fecha es la del registro (created_at), la pone el
 * servidor. Ver FLOWS.md flujo 31.
 */

const PAGE_SIZE = 30;
const MAX_NOTE_LENGTH = 5000;

const entryInclude = [
  { model: db.User, as: "author", attributes: ["id", "name", "lastname"] },
  { model: db.ProjectLogEntryFile, as: "files", attributes: ["id", "file_url", "file_name", "mime_type", "size_bytes"] },
];

async function loadEntry(id) {
  return db.ProjectLogEntry.findByPk(id, { include: entryInclude, order: [[{ model: db.ProjectLogEntryFile, as: "files" }, "id", "ASC"]] });
}

module.exports = {
  // Más nuevas primero, paginadas por id (cursor): ?before_id=N trae las anteriores a esa.
  list: async (req, res) => {
    try {
      const project = await db.Project.findByPk(req.params.projectId, { attributes: ["id"] });
      if (!project) return res.status(404).json({ error: "Proyecto no encontrado." });

      const where = { project_id: project.id };
      const beforeId = parseInt(req.query.before_id, 10);
      if (!isNaN(beforeId)) where.id = { [db.Sequelize.Op.lt]: beforeId };

      // Dos consultas (entradas y fotos) en vez de un join: con hasMany + limit, una entrada con
      // varias fotos ocuparía varias filas del límite.
      const rows = await db.ProjectLogEntry.findAll({
        where,
        include: [{ model: db.User, as: "author", attributes: ["id", "name", "lastname"] }],
        order: [["id", "DESC"]],
        limit: PAGE_SIZE + 1,
      });
      const hasMore = rows.length > PAGE_SIZE;
      const page = rows.slice(0, PAGE_SIZE);

      const files = page.length === 0 ? [] : await db.ProjectLogEntryFile.findAll({
        where: { entry_id: page.map((e) => e.id) },
        attributes: ["id", "entry_id", "file_url", "file_name", "mime_type", "size_bytes"],
        order: [["id", "ASC"]],
      });
      const filesByEntry = new Map();
      for (const file of files) {
        if (!filesByEntry.has(file.entry_id)) filesByEntry.set(file.entry_id, []);
        filesByEntry.get(file.entry_id).push(file);
      }

      const data = page.map((entry) => ({ ...entry.toJSON(), files: (filesByEntry.get(entry.id) || []).map((f) => f.toJSON()) }));
      return res.status(200).json({ data, has_more: hasMore });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    const uploadedKeys = [];
    try {
      const project = await db.Project.findByPk(req.params.projectId, { attributes: ["id"] });
      if (!project) return res.status(404).json({ error: "Proyecto no encontrado." });

      const note = (req.body.note || "").toString().trim();
      const files = req.files || [];
      if (!note && files.length === 0) return res.status(400).json({ error: "Escribí una nota o adjuntá al menos una foto." });
      if (note.length > MAX_NOTE_LENGTH) return res.status(400).json({ error: `La nota no puede superar los ${MAX_NOTE_LENGTH} caracteres.` });

      // Primero se suben las fotos; si algo falla después, se limpian para no dejar huérfanas.
      const uploaded = [];
      for (const file of files) {
        const url = await uploadToR2(file, `project-logs/${project.id}`);
        uploadedKeys.push(url);
        uploaded.push({
          file_url: url,
          file_key: url.replace(`${process.env.STORAGE_PUBLIC_URL}/`, ""),
          file_name: file.originalname,
          mime_type: file.mimetype,
          size_bytes: file.size,
        });
      }

      const transaction = await db.sequelize.transaction();
      let entry;
      try {
        entry = await db.ProjectLogEntry.create({ project_id: project.id, user_id: req.user.id, note: note || null }, { transaction });
        for (const f of uploaded) await db.ProjectLogEntryFile.create({ entry_id: entry.id, ...f }, { transaction });
        await transaction.commit();
      } catch (dbError) {
        await transaction.rollback();
        throw dbError;
      }

      return res.status(201).json({ data: await loadEntry(entry.id) });
    } catch (error) {
      await Promise.all(uploadedKeys.map((url) => deleteFromR2(url).catch(() => null)));
      return res.status(500).json({ error: error.message });
    }
  },
};
