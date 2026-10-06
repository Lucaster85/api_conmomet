const db = require("../models");
const { userHasPermission } = require("../helpers");
const { getUnspecifiedProvider, upsertPrice } = require("./materialPriceService");

/**
 * Líneas de material de un presupuesto: resolución del costo por proveedor (foto fija en la línea),
 * sincronización del costo editado con el catálogo y guardado completo de las líneas. Lo usan
 * budgetController (create/update) y additionalController (carga de materiales desde el adicional).
 */

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Retroalimenta el costo real de un Material a partir de una edición hecha en una línea de
 * presupuesto — mismo patrón que syncClientItemRate para mano de obra. El costo es por
 * proveedor: se guarda en el precio de (material, proveedor) de la línea y genera
 * MaterialCostHistory solo si cambió (ver materialPriceService.upsertPrice). Solo se llama cuando
 * ya se determinó que el usuario efectivamente cambió el costo respecto de lo que esa línea
 * tenía guardado antes — no en cada re-guardado del presupuesto sin editar.
 */
async function syncMaterialCost(material, providerId, cost, currency, userId, transaction) {
  if (!material) return null;
  const newVal = parseFloat(cost);
  if (isNaN(newVal) || newVal <= 0) return null;
  const { price } = await upsertPrice({ materialId: material.id, providerId, cost: newVal, currency, userId }, transaction);
  return price;
}

// Proveedor efectivo de una línea: el indicado, o "Sin especificar" si viene material sin proveedor.
async function resolveProviderId(providerId, transaction) {
  if (providerId) return Number(providerId);
  return (await getUnspecifiedProvider(transaction)).id;
}

/**
 * Si la línea trae material_id, resuelve el costo real del Material PARA EL PROVEEDOR de la línea
 * y lo "fotografía" en la línea (material_cost_snapshot/currency) — no se recalcula después
 * aunque el costo del material cambie. Se resuelve siempre, sin importar el permiso de quien
 * guarda: desde que el precio al cliente se calcula como margen % sobre este costo (ver
 * FLOWS.md), el sistema necesita el valor real para poder computar unit_price. La EXPOSICIÓN de
 * este campo en la respuesta sigue gateada por material_costs_read, en applyPriceVisibility.
 *
 * Si se pasa `edited` (costo distinto al que la línea tenía antes, con permiso de edición),
 * ese valor pasa a ser el nuevo precio de ese proveedor — se sincroniza vía syncMaterialCost.
 * Sin precio para el par (material, proveedor) el snapshot queda null.
 *
 * Devuelve también provider_id (el efectivo) para persistirlo en la línea.
 */
async function resolveMaterialCostSnapshot(materialId, providerId, transaction, edited) {
  if (!materialId) return { material_cost_snapshot: null, material_cost_currency: null, provider_id: providerId || null };
  const material = await db.Material.findByPk(materialId, { transaction });
  if (!material) return { material_cost_snapshot: null, material_cost_currency: null, provider_id: providerId || null };

  const effectiveProviderId = await resolveProviderId(providerId, transaction);

  if (edited) {
    const price = await syncMaterialCost(material, effectiveProviderId, edited.cost, edited.currency, edited.userId, transaction);
    return {
      material_cost_snapshot: parseFloat(edited.cost),
      material_cost_currency: edited.currency || (price && price.currency) || "ARS",
      provider_id: effectiveProviderId,
    };
  }

  const price = await db.MaterialProviderPrice.findOne({
    where: { material_id: material.id, provider_id: effectiveProviderId },
    transaction,
  });
  return {
    material_cost_snapshot: price ? price.cost : null,
    material_cost_currency: price ? price.currency : null,
    provider_id: effectiveProviderId,
  };
}

/**
 * Reemplaza las líneas de material de un presupuesto por `items` (destroy + recreate), calculando
 * el precio al cliente como costo × (1 + margen%). Lanza un Error con `status` 400 si una línea no
 * tiene costo cargado en el catálogo.
 *
 * - Una línea existente (por `id`) que no cambió de material ni de proveedor conserva su
 *   material_cost_snapshot tal cual estaba — se compara contra lo que ESA línea tenía guardado,
 *   nunca contra el costo vigente del catálogo, para que re-guardar no "detecte" un cambio cada vez
 *   que el catálogo se movió por otro lado. Si el usuario tiene material_costs_read y mandó un costo
 *   distinto, es una edición deliberada: pasa a ser el precio de ese proveedor en el catálogo.
 *   Una línea nueva o con material/proveedor cambiado resuelve el costo vigente.
 * - preserveMargins: usado por el módulo Adicionales, donde quien carga materiales NO ve ni define
 *   el margen. Las líneas existentes conservan su margin_percent guardado (aunque venga otro) y las
 *   nuevas nacen con margen 0; el margen lo carga después el área comercial desde Presupuestos.
 */
async function saveMaterialItems(budget, items, user, transaction, { preserveMargins = false } = {}) {
  const existingItems = await db.BudgetMaterialItem.findAll({
    where: { budget_id: budget.id },
    attributes: ["id", "material_id", "provider_id", "material_cost_snapshot", "material_cost_currency", "margin_percent"],
    transaction,
  });
  const existingById = new Map(existingItems.map((i) => [i.id, i]));
  const canEditCost = userHasPermission(user, "material_costs_read");

  await db.BudgetMaterialItem.destroy({ where: { budget_id: budget.id }, transaction, force: true });

  for (const item of items) {
    const quantity = parseFloat(item.quantity || 0);

    const existing = item.id ? existingById.get(item.id) : null;
    // Si el cliente no manda provider_id, la línea existente conserva el suyo.
    const requestedProviderId = item.provider_id !== undefined && item.provider_id !== null ? Number(item.provider_id) : null;
    const lineProviderId = requestedProviderId ?? (existing ? existing.provider_id : null);
    // Cambiar de proveedor cuenta como cambio de línea: re-resuelve el costo vigente de ese proveedor.
    const materialUnchanged = existing
      && (existing.material_id || null) === (item.material_id || null)
      && (existing.provider_id || null) === (lineProviderId || null);

    const editedValue = canEditCost && item.material_cost_snapshot !== undefined && item.material_cost_snapshot !== null
      ? parseFloat(item.material_cost_snapshot)
      : null;

    let costSnapshot;
    if (materialUnchanged) {
      const existingValue = existing.material_cost_snapshot !== null && existing.material_cost_snapshot !== undefined
        ? parseFloat(existing.material_cost_snapshot)
        : null;
      const genuinelyEdited = editedValue !== null && !isNaN(editedValue) && editedValue !== existingValue;

      if (genuinelyEdited) {
        const material = await db.Material.findByPk(item.material_id, { transaction });
        const providerId = await resolveProviderId(lineProviderId, transaction);
        await syncMaterialCost(material, providerId, editedValue, item.material_cost_currency || existing.material_cost_currency, user.id, transaction);
        costSnapshot = { material_cost_snapshot: editedValue, material_cost_currency: item.material_cost_currency || existing.material_cost_currency, provider_id: providerId };
      } else {
        costSnapshot = { material_cost_snapshot: existing.material_cost_snapshot, material_cost_currency: existing.material_cost_currency, provider_id: existing.provider_id };
      }
    } else {
      costSnapshot = await resolveMaterialCostSnapshot(
        item.material_id,
        lineProviderId,
        transaction,
        editedValue !== null && !isNaN(editedValue) ? { cost: editedValue, currency: item.material_cost_currency, userId: user.id } : null
      );
    }

    // El precio al cliente se calcula como margen % sobre el costo real — un material sin
    // vincular al catálogo, o sin costo cargado ahí, no se puede presupuestar.
    if (costSnapshot.material_cost_snapshot === null || costSnapshot.material_cost_snapshot === undefined) {
      throw httpError(400, `El material "${item.description || "sin descripción"}" no tiene costo cargado en el catálogo. Cárguelo antes de presupuestarlo.`);
    }

    const cost = parseFloat(costSnapshot.material_cost_snapshot);
    // El margen de materiales no depende de budget_prices_read (solo la mano de obra).
    const marginPercent = preserveMargins
      ? (existing ? parseFloat(existing.margin_percent || 0) : 0)
      : parseFloat(item.margin_percent || 0);
    const unitPrice = Math.round(cost * (1 + marginPercent / 100) * 100) / 100;

    await db.BudgetMaterialItem.create({
      budget_id: budget.id,
      material_id: item.material_id,
      description: item.description,
      quantity,
      material_unit_id: item.material_unit_id,
      unit_price: unitPrice,
      currency: costSnapshot.material_cost_currency,
      margin_percent: marginPercent,
      total_price: quantity * unitPrice,
      notes: item.notes || null,
      ...costSnapshot,
    }, { transaction });
  }
}

module.exports = { saveMaterialItems, resolveMaterialCostSnapshot, syncMaterialCost, resolveProviderId };
