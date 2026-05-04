const { Op } = require("sequelize");
const db = require("../models");

module.exports = {
  getAll: async (req, res) => {
    try {
      const { applies_to } = req.query;
      const where = {};

      if (applies_to) where.applies_to = applies_to;

      const categories = await db.DocumentCategory.findAll({
        where,
        order: [["name", "ASC"]],
      });

      return res.status(200).json({ data: categories });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  get: async (req, res) => {
    try {
      const category = await db.DocumentCategory.findByPk(req.params.id);
      if (!category) return res.status(404).json({ error: "Categoría no encontrada." });

      return res.status(200).json({ data: category });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    try {
      const { name, description, applies_to, is_plant_specific } = req.body;

      if (!name || !applies_to) {
        return res.status(400).json({ error: "Nombre y tipo de entidad son obligatorios." });
      }

      const category = await db.DocumentCategory.create({
        name,
        description: description || null,
        applies_to,
        is_plant_specific: is_plant_specific || false,
      });

      return res.status(201).json({ data: category });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  update: async (req, res) => {
    try {
      const category = await db.DocumentCategory.findByPk(req.params.id);
      if (!category) return res.status(404).json({ error: "Categoría no encontrada." });

      const { name, description, applies_to, is_plant_specific } = req.body;

      await category.update({
        name: name !== undefined ? name : category.name,
        description: description !== undefined ? description : category.description,
        applies_to: applies_to !== undefined ? applies_to : category.applies_to,
        is_plant_specific: is_plant_specific !== undefined ? is_plant_specific : category.is_plant_specific,
      });

      return res.status(200).json({ data: category });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  destroy: async (req, res) => {
    try {
      const category = await db.DocumentCategory.findByPk(req.params.id);
      if (!category) return res.status(404).json({ error: "Categoría no encontrada." });

      // Check if category is used in any plant requirements
      const requirementCount = await db.PlantRequirement.count({
        where: { document_category_id: category.id },
      });
      if (requirementCount > 0) {
        return res.status(400).json({
          error: `No se puede eliminar: está asignada como requisito en ${requirementCount} planta(s).`,
        });
      }

      // Check if any documents use this category
      const docCount = await db.EntityDocument.count({
        where: { document_category_id: category.id },
      });
      if (docCount > 0) {
        return res.status(400).json({
          error: `No se puede eliminar: ${docCount} documento(s) están clasificados con esta categoría.`,
        });
      }

      await category.destroy();
      return res.status(200).json({ message: "Categoría eliminada." });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
