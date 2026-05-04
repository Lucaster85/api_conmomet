const { Op } = require("sequelize");
const db = require("../models");

module.exports = {
  /**
   * GET /plants/:id/requirements
   * List all requirements for a plant
   */
  getAll: async (req, res) => {
    try {
      const plant = await db.Plant.findByPk(req.params.id);
      if (!plant) return res.status(404).json({ error: "Planta no encontrada." });

      const requirements = await db.PlantRequirement.findAll({
        where: { plant_id: plant.id },
        include: [
          { model: db.DocumentCategory, as: "documentCategory", attributes: ["id", "name", "applies_to", "is_plant_specific"] },
        ],
        order: [["is_mandatory", "DESC"], [{ model: db.DocumentCategory, as: "documentCategory" }, "name", "ASC"]],
      });

      return res.status(200).json({ data: requirements });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  /**
   * POST /plants/:id/requirements
   * Add a requirement to a plant
   */
  create: async (req, res) => {
    try {
      const plant = await db.Plant.findByPk(req.params.id);
      if (!plant) return res.status(404).json({ error: "Planta no encontrada." });

      const { document_category_id, is_mandatory, notes } = req.body;

      if (!document_category_id) {
        return res.status(400).json({ error: "La categoría de documento es obligatoria." });
      }

      const category = await db.DocumentCategory.findByPk(document_category_id);
      if (!category) return res.status(400).json({ error: "Categoría de documento no encontrada." });

      // Check if already exists
      const existing = await db.PlantRequirement.findOne({
        where: { plant_id: plant.id, document_category_id },
      });
      if (existing) {
        return res.status(400).json({ error: `La planta ya requiere "${category.name}".` });
      }

      const requirement = await db.PlantRequirement.create({
        plant_id: plant.id,
        document_category_id,
        is_mandatory: is_mandatory !== undefined ? is_mandatory : true,
        notes: notes || null,
      });

      // Reload with association
      const result = await db.PlantRequirement.findByPk(requirement.id, {
        include: [
          { model: db.DocumentCategory, as: "documentCategory", attributes: ["id", "name", "applies_to", "is_plant_specific"] },
        ],
      });

      return res.status(201).json({ data: result });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  /**
   * PUT /plants/:id/requirements/:reqId
   * Update a plant requirement
   */
  update: async (req, res) => {
    try {
      const requirement = await db.PlantRequirement.findOne({
        where: { id: req.params.reqId, plant_id: req.params.id },
      });
      if (!requirement) return res.status(404).json({ error: "Requisito no encontrado." });

      const { is_mandatory, notes } = req.body;

      await requirement.update({
        is_mandatory: is_mandatory !== undefined ? is_mandatory : requirement.is_mandatory,
        notes: notes !== undefined ? notes : requirement.notes,
      });

      const result = await db.PlantRequirement.findByPk(requirement.id, {
        include: [
          { model: db.DocumentCategory, as: "documentCategory", attributes: ["id", "name", "applies_to", "is_plant_specific"] },
        ],
      });

      return res.status(200).json({ data: result });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  /**
   * DELETE /plants/:id/requirements/:reqId
   * Remove a plant requirement
   */
  destroy: async (req, res) => {
    try {
      const requirement = await db.PlantRequirement.findOne({
        where: { id: req.params.reqId, plant_id: req.params.id },
      });
      if (!requirement) return res.status(404).json({ error: "Requisito no encontrado." });

      await requirement.destroy();
      return res.status(200).json({ message: "Requisito eliminado." });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
