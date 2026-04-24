const db = require("../models");
const { uploadToR2, deleteFromR2 } = require("../helpers");

module.exports = {
  getAll: async (req, res) => {
    try {
      const { entity_type, entity_id } = req.query;
      const where = {};
      
      if (entity_type) where.entity_type = entity_type;
      if (entity_id) where.entity_id = entity_id;

      const documents = await db.EntityDocument.findAll({
        where,
        include: [
          { model: db.User, as: "uploader", attributes: ["id", "name", "lastname"] },
          { model: db.User, as: "resolver", attributes: ["id", "name", "lastname"] },
        ],
        order: [["created_at", "DESC"]],
      });

      // The virtual field `computed_status` is automatically included in the JSON representation
      // by Sequelize when toJSON() is called during res.json().
      return res.status(200).json({ count: documents.length, data: documents });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    const { title, notes, entity_type, entity_id, expiration_date, notify_days_before } = req.body;
    const file = req.file;

    if (!title || !entity_type) {
      return res.status(400).json({ error: "El título y el tipo de entidad son obligatorios." });
    }

    try {
      let file_url = null;
      let file_key = null;
      let file_name = null;

      if (file) {
        // Build folder path based on entity
        const folder = `documents/${entity_type}/${entity_id || 'global'}`;
        file_url = await uploadToR2(file, folder);
        file_key = file_url.replace(`${process.env.STORAGE_PUBLIC_URL}/`, "");
        file_name = file.originalname;
      }

      const document = await db.EntityDocument.create({
        title,
        notes,
        entity_type,
        entity_id: entity_id ? parseInt(entity_id) : null,
        file_url,
        file_key,
        file_name,
        expiration_date: expiration_date || null,
        notify_days_before: notify_days_before ? parseInt(notify_days_before) : 15,
        alert_status: "pending",
        uploaded_by: req.user.id,
      });

      return res.status(201).json({ data: document });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  update: async (req, res) => {
    const { id } = req.params;
    const { title, notes, expiration_date, notify_days_before } = req.body;
    const file = req.file;

    try {
      const document = await db.EntityDocument.findByPk(id);
      if (!document) return res.status(404).json({ error: "Documento no encontrado." });

      let file_url = document.file_url;
      let file_key = document.file_key;
      let file_name = document.file_name;

      if (file) {
        // User is uploading a new file (e.g. renewing the document)
        if (document.file_url) {
          await deleteFromR2(document.file_url);
        }
        const folder = `documents/${document.entity_type}/${document.entity_id || 'global'}`;
        file_url = await uploadToR2(file, folder);
        file_key = file_url.replace(`${process.env.STORAGE_PUBLIC_URL}/`, "");
        file_name = file.originalname;
      }

      // If they send a new expiration date, we consider it renewed/resolved and reset the alert loop
      let resolved_at = document.resolved_at;
      let resolved_by = document.resolved_by;
      let alert_status = document.alert_status;

      if (expiration_date && expiration_date !== document.expiration_date) {
        resolved_at = new Date();
        resolved_by = req.user.id;
        alert_status = "pending"; // Reset alert for the new date
      }

      await document.update({
        title: title || document.title,
        notes: notes !== undefined ? notes : document.notes,
        expiration_date: expiration_date !== undefined ? (expiration_date || null) : document.expiration_date,
        notify_days_before: notify_days_before !== undefined ? parseInt(notify_days_before) : document.notify_days_before,
        file_url,
        file_key,
        file_name,
        resolved_at,
        resolved_by,
        alert_status,
      });

      return res.status(200).json({ data: document });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  destroy: async (req, res) => {
    const { id } = req.params;
    try {
      const document = await db.EntityDocument.findByPk(id);
      if (!document) return res.status(404).json({ error: "Documento no encontrado." });

      if (document.file_url) {
        await deleteFromR2(document.file_url);
      }
      await document.destroy();

      return res.status(200).json({ message: "Documento eliminado correctamente." });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
