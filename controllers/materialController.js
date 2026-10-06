const { Op } = require("sequelize");
const db = require("../models");
const { userHasPermission } = require("../helpers");
const { parseMaterialSheet } = require("../helpers/materialSheetParser");
const { findOrCreateUnitByLabel } = require("../helpers/materialUnits");
const { getUnspecifiedProvider, findOrCreateProvider, upsertPrice } = require("../services/materialPriceService");

const materialInclude = [
  { model: db.MaterialUnit, as: "materialUnit" },
  {
    model: db.MaterialProviderPrice, as: "providerPrices",
    include: [{ model: db.Provider, as: "provider", paranoid: false, attributes: ["id", "razonSocial", "is_system"] }],
  },
];

// Sin material_costs_read el nombre del proveedor se ve, pero no cuánto cuesta con cada uno.
function stripCost(material) {
  return {
    ...material,
    providerPrices: (material.providerPrices || []).map((price) => ({ ...price, cost: null, currency: null })),
  };
}

const parseKgPerMeter = (value) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = parseFloat(value);
  return isNaN(parsed) || parsed <= 0 ? null : parsed;
};

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Semántica de reemplazo: upsert de los precios enviados y borrado de los ausentes. Cada
 * proveedor aparece una sola vez (el último gana).
 */
async function replaceProviderPrices(materialId, providerPrices, userId, transaction) {
  const byProvider = new Map();
  for (const entry of providerPrices) {
    if (!entry || !entry.provider_id) throw httpError(400, "Cada precio debe indicar un proveedor.");
    byProvider.set(Number(entry.provider_id), entry);
  }

  const providers = await db.Provider.findAll({ where: { id: [...byProvider.keys()] }, transaction });
  if (providers.length !== byProvider.size) throw httpError(400, "Alguno de los proveedores indicados no existe.");

  for (const [providerId, entry] of byProvider) {
    await upsertPrice({
      materialId,
      providerId,
      cost: entry.cost,
      currency: entry.currency,
      userId,
    }, transaction);
  }

  const where = { material_id: materialId };
  if (byProvider.size > 0) where.provider_id = { [Op.notIn]: [...byProvider.keys()] };
  await db.MaterialProviderPrice.destroy({ where, transaction });
}

async function respondWithMaterial(res, status, materialId, canSeeCosts) {
  const fullMaterial = await db.Material.findByPk(materialId, { include: materialInclude });
  const json = fullMaterial.toJSON();
  return res.status(status).json({ data: canSeeCosts ? json : stripCost(json) });
}

module.exports = {
  getAll: async (req, res) => {
    try {
      const { q, is_active } = req.query;
      const where = {};
      if (is_active !== undefined) where.is_active = is_active === "true";
      if (q) where.description = { [Op.like]: `%${q}%` };

      const materials = await db.Material.findAll({
        where,
        include: materialInclude,
        order: [["description", "ASC"]],
      });

      const canSeeCosts = userHasPermission(req.user, "material_costs_read");
      const data = materials.map((m) => {
        const json = m.toJSON();
        return canSeeCosts ? json : stripCost(json);
      });

      return res.status(200).json({ data });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    const transaction = await db.sequelize.transaction();
    try {
      const { description, material_unit_id, kg_per_meter, provider_prices, is_active } = req.body;
      if (!description || !material_unit_id) {
        await transaction.rollback();
        return res.status(400).json({ error: "Descripción y unidad son obligatorias." });
      }

      const canSeeCosts = userHasPermission(req.user, "material_costs_read");

      const material = await db.Material.create({
        description,
        material_unit_id,
        kg_per_meter: parseKgPerMeter(kg_per_meter) ?? null,
        is_active: is_active !== undefined ? is_active : true,
      }, { transaction });

      if (canSeeCosts && Array.isArray(provider_prices)) {
        await replaceProviderPrices(material.id, provider_prices, req.user.id, transaction);
      }

      await transaction.commit();
      return respondWithMaterial(res, 201, material.id, canSeeCosts);
    } catch (error) {
      await transaction.rollback();
      return res.status(error.status || 500).json({ error: error.message });
    }
  },

  update: async (req, res) => {
    const transaction = await db.sequelize.transaction();
    try {
      const material = await db.Material.findByPk(req.params.id, { transaction });
      if (!material) {
        await transaction.rollback();
        return res.status(404).json({ error: "Material no encontrado." });
      }

      const { description, material_unit_id, kg_per_meter, provider_prices, is_active } = req.body;
      const canSeeCosts = userHasPermission(req.user, "material_costs_read");

      const newKg = parseKgPerMeter(kg_per_meter);

      await material.update({
        description: description !== undefined ? description : material.description,
        material_unit_id: material_unit_id !== undefined ? material_unit_id : material.material_unit_id,
        kg_per_meter: newKg !== undefined ? newKg : material.kg_per_meter,
        is_active: is_active !== undefined ? is_active : material.is_active,
      }, { transaction });

      if (canSeeCosts && Array.isArray(provider_prices)) {
        await replaceProviderPrices(material.id, provider_prices, req.user.id, transaction);
      }

      await transaction.commit();
      return respondWithMaterial(res, 200, material.id, canSeeCosts);
    } catch (error) {
      await transaction.rollback();
      return res.status(error.status || 500).json({ error: error.message });
    }
  },

  getCostHistory: async (req, res) => {
    try {
      // La ruta anidada resuelve el permiso genérico "materials_read" (por path) — el costo
      // en sí necesita el permiso más estricto, chequeado acá a mano.
      if (!userHasPermission(req.user, "material_costs_read")) {
        return res.status(403).json({ error: "No tiene permiso para ver el historial de costos." });
      }

      const material = await db.Material.findByPk(req.params.id);
      if (!material) return res.status(404).json({ error: "Material no encontrado." });

      const history = await db.MaterialCostHistory.findAll({
        where: { material_id: material.id },
        include: [
          { model: db.User, as: "changedBy", attributes: ["id", "name", "lastname"] },
          { model: db.Provider, as: "provider", paranoid: false, attributes: ["id", "razonSocial", "is_system"] },
        ],
        order: [["created_at", "DESC"]],
      });

      return res.status(200).json({ data: history });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  destroy: async (req, res) => {
    try {
      const material = await db.Material.findByPk(req.params.id);
      if (!material) return res.status(404).json({ error: "Material no encontrado." });

      const usageCount = await db.BudgetMaterialItem.count({ where: { material_id: material.id } });
      if (usageCount > 0) {
        return res.status(400).json({ error: `No se puede eliminar: está usado en ${usageCount} línea(s) de presupuesto. Desactívelo en su lugar.` });
      }

      await material.destroy();
      return res.status(200).json({ message: "Material eliminado." });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // Parseo "stateless" de Excel del catálogo de materiales — no persiste nada, solo
  // devuelve filas de previsualización (el import real es importCommit).
  importPreview: async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Debe subir un archivo .xlsx/.xls." });
      }

      const canSeeCosts = userHasPermission(req.user, "material_costs_read");
      const parsed = await parseMaterialSheet(req.file.buffer);

      const rows = parsed.map((row) => ({
        description: row.description,
        unit: row.unit,
        provider: row.provider,
        cost: canSeeCosts ? row.cost : null,
        currency: canSeeCosts ? row.currency : null,
        kg_per_meter: row.kg_per_meter,
      }));

      return res.status(200).json({ data: rows });
    } catch (error) {
      return res.status(error.status || 500).json({ error: error.status ? error.message : `No se pudo leer el archivo: ${error.message}` });
    }
  },

  /**
   * Confirmación del import (catálogo y presupuesto), todo en una transacción: crea las unidades
   * y proveedores que falten, el material si no existe (por descripción, case-insensitive) y
   * guarda el precio de (material, proveedor). Un mismo material puede venir en varias filas,
   * una por proveedor. Devuelve por fila el costo efectivo guardado.
   */
  importCommit: async (req, res) => {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: "No hay filas para importar." });
    }

    const canSeeCosts = userHasPermission(req.user, "material_costs_read");
    const transaction = await db.sequelize.transaction();
    try {
      const unitsByLabel = new Map();
      const unitLabelById = new Map();
      const providersByName = new Map();
      const materialsByDescription = new Map();
      const summary = { materials_created: 0, units_created: 0, providers_created: 0, prices_updated: 0 };
      const result = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i] || {};
        const description = String(row.description ?? "").trim();
        if (!description) throw httpError(400, `Fila ${i + 1}: falta la descripción.`);
        if (description.length > 255) throw httpError(400, `Fila ${i + 1}: la descripción supera los 255 caracteres.`);

        const unitLabel = String(row.unit ?? "").trim() || "u";
        if (unitLabel.length > 20) throw httpError(400, `Fila ${i + 1}: la unidad "${unitLabel}" supera los 20 caracteres.`);

        // Unidad
        const unitKey = unitLabel.toLowerCase();
        let unit = unitsByLabel.get(unitKey);
        if (!unit) {
          const found = await findOrCreateUnitByLabel(unitLabel, { transaction });
          unit = found.unit;
          if (found.created) summary.units_created++;
          unitsByLabel.set(unitKey, unit);
          unitLabelById.set(unit.id, unit.label);
        }

        // Proveedor (vacío → "Sin especificar")
        const providerName = String(row.provider ?? "").trim();
        const providerKey = providerName.toLowerCase();
        let provider = providersByName.get(providerKey);
        if (!provider) {
          if (!providerName) {
            provider = await getUnspecifiedProvider(transaction);
          } else {
            const found = await findOrCreateProvider(providerName, transaction);
            provider = found.provider;
            if (found.created) summary.providers_created++;
          }
          providersByName.set(providerKey, provider);
        }

        // Material
        const materialKey = description.toLowerCase();
        let material = materialsByDescription.get(materialKey);
        if (!material) {
          material = await db.Material.findOne({
            where: db.sequelize.where(db.sequelize.fn("LOWER", db.sequelize.col("description")), materialKey),
            transaction,
          });
          if (!material) {
            material = await db.Material.create({
              description,
              material_unit_id: unit.id,
              kg_per_meter: parseKgPerMeter(row.kg_per_meter) ?? null,
              is_active: true,
            }, { transaction });
            summary.materials_created++;
          }
          materialsByDescription.set(materialKey, material);
        }

        const kg = parseKgPerMeter(row.kg_per_meter);
        if (kg !== undefined && kg !== null && parseFloat(material.kg_per_meter) !== kg) {
          await material.update({ kg_per_meter: kg }, { transaction });
        }

        // Precio — sin material_costs_read el costo se ignora, pero el vínculo se asegura igual.
        const { price, changed } = await upsertPrice({
          materialId: material.id,
          providerId: provider.id,
          cost: canSeeCosts ? row.cost : null,
          currency: canSeeCosts ? row.currency : null,
          userId: req.user.id,
        }, transaction);
        if (changed) summary.prices_updated++;

        // Un material que ya existía conserva su unidad, aunque la fila traiga otra.
        if (!unitLabelById.has(material.material_unit_id)) {
          const materialUnit = await db.MaterialUnit.findByPk(material.material_unit_id, { paranoid: false, transaction });
          unitLabelById.set(material.material_unit_id, materialUnit.label);
        }

        result.push({
          material_id: material.id,
          material_unit_id: material.material_unit_id,
          unit: unitLabelById.get(material.material_unit_id),
          provider_id: provider.id,
          provider_name: provider.razonSocial,
          cost: canSeeCosts && price.cost !== null ? parseFloat(price.cost) : null,
          currency: canSeeCosts ? price.currency : null,
        });
      }

      await transaction.commit();
      return res.status(200).json({ data: result, summary });
    } catch (error) {
      await transaction.rollback();
      return res.status(error.status || 500).json({ error: error.message });
    }
  },
};
