const db = require("../models");
const { uploadToR2, deleteFromR2 } = require("../helpers");

module.exports = {
  getAll: async (req, res) => {
    try {
      const { count, rows } = await db.Media.findAndCountAll({
        order: [["order", "ASC"], ["created_at", "DESC"]],
      });
      return res.status(200).json({ count, data: rows });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  getByType: async (req, res) => {
    const { type } = req.params;
    try {
      const { count, rows } = await db.Media.findAndCountAll({
        where: { type },
        order: [["order", "ASC"], ["created_at", "DESC"]],
      });
      return res.status(200).json({ count, data: rows });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  get: async (req, res) => {
    try {
      const item = await db.Media.findByPk(req.params.id);
      if (!item) return res.status(400).json({ error: "Recurso no encontrado." });
      return res.status(200).json({ data: item });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  upload: async (req, res) => {
    const { type, title, description, order } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "No se adjuntó ningún archivo." });
    }

    if (!type) {
      return res.status(400).json({ error: "El campo 'type' es requerido." });
    }

    try {
      const url = await uploadToR2(file, type);

      const media = await db.Media.create({
        title,
        description,
        type,
        order: order ? parseInt(order) : null,
        url,
      });

      return res.status(201).json({ data: media });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  update: async (req, res) => {
    try {
      const item = await db.Media.findByPk(req.params.id);
      if (!item) return res.status(400).json({ error: "Recurso no encontrado." });

      const { title, description, order, is_active } = req.body;
      const file = req.file;

      let url = item.url;

      if (file) {
        await deleteFromR2(item.url);
        url = await uploadToR2(file, item.type);
      }

      await item.update({ title, description, order: order ? parseInt(order) : item.order, is_active, url });

      return res.status(200).json({ data: item });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  destroy: async (req, res) => {
    try {
      const item = await db.Media.findByPk(req.params.id);
      if (!item) return res.status(400).json({ error: "Recurso no encontrado." });

      await deleteFromR2(item.url);
      await item.destroy();

      return res.status(200).json({ message: "Recurso eliminado correctamente." });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  reorder: async (req, res) => {
    const { orderedIds } = req.body;

    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return res.status(400).json({ error: "orderedIds debe ser un array con al menos un elemento." });
    }

    try {
      await Promise.all(
        orderedIds.map((id, index) =>
          db.Media.update({ order: index }, { where: { id } })
        )
      );
      return res.status(200).json({ message: "Orden actualizado correctamente." });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};