const db = require("../models");

/**
 * Lógica compartida del precio de un Material por Proveedor (MaterialProviderPrice) y su
 * historial (MaterialCostHistory). La usan el ABM de materiales, el import de catálogo y el
 * presupuesto (cuando se edita el costo en una línea).
 */

const NORMALIZE = (value) => (value === null || value === undefined ? "" : String(value).trim());

async function getUnspecifiedProvider(transaction) {
  const provider = await db.Provider.findOne({ where: { is_system: true }, transaction });
  if (!provider) {
    throw new Error('No existe el proveedor de sistema "Sin especificar". Corra las migraciones pendientes.');
  }
  return provider;
}

/**
 * Busca (case-insensitive, incluyendo borrados) o crea un proveedor por nombre. Un borrado se
 * restaura. Nombre vacío → "Sin especificar". Devuelve { provider, created }.
 */
async function findOrCreateProvider(name, transaction) {
  const normalized = NORMALIZE(name);
  if (!normalized) return { provider: await getUnspecifiedProvider(transaction), created: false };

  const existing = await db.Provider.findOne({
    where: db.sequelize.where(
      db.sequelize.fn("LOWER", db.sequelize.col("razon_social")),
      normalized.toLowerCase()
    ),
    paranoid: false,
    transaction,
  });
  if (existing) {
    if (existing.deletedAt) await existing.restore({ transaction });
    return { provider: existing, created: false };
  }
  const provider = await db.Provider.create({ razonSocial: normalized.slice(0, 150) }, { transaction });
  return { provider, created: true };
}

async function findOrCreateProviderByName(name, transaction) {
  return (await findOrCreateProvider(name, transaction)).provider;
}

/**
 * Crea o actualiza el precio de (material, proveedor). Escribe MaterialCostHistory SOLO si el
 * costo (o la moneda) efectivamente cambió. Un `cost` nulo nunca pisa un precio existente: solo
 * asegura que el vínculo exista (con cost null si es nuevo).
 *
 * Devuelve { price, created, changed }.
 */
async function upsertPrice({ materialId, providerId, cost, currency, userId }, transaction) {
  const parsed = cost === null || cost === undefined || cost === "" ? null : parseFloat(cost);
  const newCost = parsed !== null && !isNaN(parsed) ? parsed : null;

  let price = await db.MaterialProviderPrice.findOne({
    where: { material_id: materialId, provider_id: providerId },
    transaction,
  });

  if (!price) {
    price = await db.MaterialProviderPrice.create({
      material_id: materialId,
      provider_id: providerId,
      cost: newCost,
      currency: newCost !== null ? (currency || "ARS") : (currency || null),
    }, { transaction });
    if (newCost !== null) {
      await db.MaterialCostHistory.create({
        material_id: materialId,
        provider_id: providerId,
        cost: newCost,
        currency: price.currency,
        changed_by: userId,
      }, { transaction });
    }
    return { price, created: true, changed: newCost !== null };
  }

  if (newCost === null) return { price, created: false, changed: false };

  const newCurrency = currency || price.currency || "ARS";
  const oldVal = price.cost !== null && price.cost !== undefined ? parseFloat(price.cost) : null;
  if (oldVal === newCost && (price.currency || null) === newCurrency) {
    return { price, created: false, changed: false };
  }

  await db.MaterialCostHistory.create({
    material_id: materialId,
    provider_id: providerId,
    cost: newCost,
    currency: newCurrency,
    changed_by: userId,
  }, { transaction });
  await price.update({ cost: newCost, currency: newCurrency }, { transaction });
  return { price, created: false, changed: true };
}

module.exports = { getUnspecifiedProvider, findOrCreateProvider, findOrCreateProviderByName, upsertPrice };
