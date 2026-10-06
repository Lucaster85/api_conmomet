const db = require("../models");
const { findOrCreateProvider } = require("../services/materialPriceService");

/**
 * ABM rápido de proveedores (solo nombre) colgado de /materials/providers, para que resuelva a
 * los permisos materials_* sin tocar /providers (que queda para el futuro módulo completo).
 */

const ATTRIBUTES = ["id", "razonSocial", "is_system"];

module.exports = {
  getAll: async (req, res) => {
    try {
      const data = await db.Provider.findAll({
        attributes: ATTRIBUTES,
        // "Sin especificar" primero, después alfabético.
        order: [["is_system", "DESC"], ["razon_social", "ASC"]],
      });
      return res.status(200).json({ data });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    try {
      const name = (req.body.razonSocial || req.body.name || "").toString().trim();
      if (!name) return res.status(400).json({ error: "El nombre del proveedor es obligatorio." });
      if (name.length > 150) return res.status(400).json({ error: "El nombre del proveedor no puede superar los 150 caracteres." });

      const { provider, created } = await findOrCreateProvider(name);
      return res.status(created ? 201 : 200).json({
        data: { id: provider.id, razonSocial: provider.razonSocial, is_system: provider.is_system },
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  update: async (req, res) => {
    try {
      const provider = await db.Provider.findByPk(req.params.id);
      if (!provider) return res.status(404).json({ error: "Proveedor no encontrado." });
      if (provider.is_system) return res.status(400).json({ error: "El proveedor \"Sin especificar\" no se puede modificar." });

      const name = (req.body.razonSocial || req.body.name || "").toString().trim();
      if (!name) return res.status(400).json({ error: "El nombre del proveedor es obligatorio." });
      if (name.length > 150) return res.status(400).json({ error: "El nombre del proveedor no puede superar los 150 caracteres." });

      const duplicate = await db.Provider.findOne({
        where: {
          [db.Sequelize.Op.and]: [
            db.sequelize.where(db.sequelize.fn("LOWER", db.sequelize.col("razon_social")), name.toLowerCase()),
            { id: { [db.Sequelize.Op.ne]: provider.id } },
          ],
        },
      });
      if (duplicate) return res.status(400).json({ error: `Ya existe un proveedor llamado "${duplicate.razonSocial}".` });

      await provider.update({ razonSocial: name });
      return res.status(200).json({ data: { id: provider.id, razonSocial: provider.razonSocial, is_system: provider.is_system } });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // Soft delete. Sus precios en el catálogo se borran (el historial se conserva); las líneas de
  // presupuesto siguen mostrando el nombre porque el include del proveedor va con paranoid:false.
  destroy: async (req, res) => {
    const transaction = await db.sequelize.transaction();
    try {
      const provider = await db.Provider.findByPk(req.params.id, { transaction });
      if (!provider) {
        await transaction.rollback();
        return res.status(404).json({ error: "Proveedor no encontrado." });
      }
      if (provider.is_system) {
        await transaction.rollback();
        return res.status(400).json({ error: "El proveedor \"Sin especificar\" no se puede eliminar." });
      }

      await db.MaterialProviderPrice.destroy({ where: { provider_id: provider.id }, transaction });
      await provider.destroy({ transaction });
      await transaction.commit();
      return res.status(200).json({ message: "Proveedor eliminado." });
    } catch (error) {
      await transaction.rollback();
      return res.status(500).json({ error: error.message });
    }
  },
};
