const db = require("../models");

/**
 * Busca o crea una unidad de medida por etiqueta (case-insensitive), incluyendo soft-eliminadas
 * (se restauran). Evita que un retry de importación o un alta concurrente desde el autocomplete
 * "creatable" choque con la unique constraint en vez de resolver a la unidad ya existente.
 * Devuelve { unit, created }.
 */
async function findOrCreateUnitByLabel(label, { displayOrder = 0, isActive = true, transaction } = {}) {
  const normalizedLabel = String(label).trim();

  const existing = await db.MaterialUnit.findOne({
    where: db.sequelize.where(
      db.sequelize.fn("LOWER", db.sequelize.col("label")),
      normalizedLabel.toLowerCase()
    ),
    paranoid: false,
    transaction,
  });

  if (existing) {
    if (existing.deletedAt) {
      await existing.restore({ transaction });
      await existing.update({ is_active: true }, { transaction });
    }
    return { unit: existing, created: false };
  }

  const unit = await db.MaterialUnit.create({
    label: normalizedLabel,
    display_order: displayOrder,
    is_active: isActive,
  }, { transaction });
  return { unit, created: true };
}

module.exports = { findOrCreateUnitByLabel };
