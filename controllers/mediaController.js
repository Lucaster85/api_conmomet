const db = require("../models");
const { uploadToR2, deleteFromR2, getSignedFileUrl } = require("../helpers");

// La landing no tiene sesión, así que las imágenes se firman acá con un TTL largo (6 h). `url` (la
// referencia canónica) no se toca; el cliente muestra `view_url ?? url`. view_url nunca se persiste:
// update() solo toma title/description/order/is_active del body.
const VIEW_URL_TTL = 6 * 60 * 60;

const withViewUrl = async (item) => {
  const plain = typeof item.toJSON === "function" ? item.toJSON() : item;
  let view_url = null;
  try {
    view_url = await getSignedFileUrl(plain.url, { expiresIn: VIEW_URL_TTL });
  } catch {
    // Si falla la firma, el cliente cae a `url` (sigue andando mientras el bucket sea público).
  }
  return { ...plain, view_url };
};

module.exports = {
  getAll: async (req, res) => {
    try {
      const { count, rows } = await db.Media.findAndCountAll({
        order: [["order", "ASC"], ["created_at", "DESC"]],
      });
      return res.status(200).json({ count, data: await Promise.all(rows.map(withViewUrl)) });
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
      return res.status(200).json({ count, data: await Promise.all(rows.map(withViewUrl)) });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  get: async (req, res) => {
    try {
      const item = await db.Media.findByPk(req.params.id);
      if (!item) return res.status(400).json({ error: "Recurso no encontrado." });
      return res.status(200).json({ data: await withViewUrl(item) });
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