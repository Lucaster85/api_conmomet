const { Op } = require("sequelize");
const db = require("../models");

/**
 * Creación de presupuestos compartida entre budgetController (crear/duplicar) y
 * additionalController (alta de un adicional y "Nuevo presupuesto").
 */

/**
 * Auto-generates a budget number like PRES-2026-001
 */
async function generateBudgetNumber(transaction) {
  const year = new Date().getFullYear();
  const prefix = `PRES-${year}-`;

  const lastBudget = await db.Budget.findOne({
    where: { number: { [Op.like]: `${prefix}%` } },
    order: [["number", "DESC"]],
    paranoid: false,
    transaction,
  });

  let seq = 1;
  if (lastBudget && lastBudget.number) {
    const lastSeq = parseInt(lastBudget.number.replace(prefix, ""), 10);
    if (!isNaN(lastSeq)) seq = lastSeq + 1;
  }

  return `${prefix}${String(seq).padStart(3, "0")}`;
}

/**
 * Copia un presupuesto como un BORRADOR nuevo, con sus líneas de mano de obra y de material.
 * `original` debe traer cargadas `laborLines` y `materialItems`.
 *
 * overrides:
 * - title / description: por defecto "<título> (copia)" y la descripción del original.
 * - project_id: proyecto al que queda vinculada la copia. Solo se pasa para el presupuesto de un
 *   ADICIONAL: ahí la copia queda del mismo adicional (si no, quedaría huérfana y al aprobarla
 *   "Generar proyecto" crearía un P-… desconectado). Para un proyecto normal no se copia a
 *   propósito: dos borradores no deben competir por el mismo proyecto.
 * - quoteRequest: PC al que queda atada la copia (hereda cliente/planta de ahí). Sin él nace libre.
 *
 * existing_project_id NO se copia nunca, por la misma razón que arriba.
 */
async function duplicateBudget(original, overrides, user, transaction) {
  const { title, description, project_id, quoteRequest } = overrides || {};
  const number = await generateBudgetNumber(transaction);

  const copy = await db.Budget.create({
    number,
    title: title !== undefined ? title : `${original.title} (copia)`,
    client_id: quoteRequest ? quoteRequest.client_id : original.client_id,
    plant_id: quoteRequest ? quoteRequest.plant_id : original.plant_id,
    currency: original.currency,
    parent_project_id: original.parent_project_id,
    project_id: project_id || null,
    existing_project_id: null,
    description: description !== undefined ? description : original.description,
    start_date: original.start_date,
    end_date: original.end_date,
    validity_days: original.validity_days,
    notes: original.notes,
    quote_request_id: quoteRequest ? quoteRequest.id : null,
    status: "draft",
    created_by: user.id,
  }, { transaction });

  // En el orden original (id), para que el Detalle de mano de obra conserve su numeración.
  for (const line of [...original.laborLines].sort((a, b) => a.id - b.id)) {
    await db.BudgetLaborLine.create({
      budget_id: copy.id,
      budget_item_type_id: line.budget_item_type_id,
      quantity: line.quantity,
      unit_price: line.unit_price,
      currency: line.currency,
      estimated_total: line.estimated_total,
      hours_per_day: line.hours_per_day,
      description: line.description,
      notes: line.notes,
    }, { transaction });
  }

  for (const item of original.materialItems) {
    await db.BudgetMaterialItem.create({
      budget_id: copy.id,
      material_id: item.material_id,
      provider_id: item.provider_id,
      description: item.description,
      quantity: item.quantity,
      material_unit_id: item.material_unit_id,
      unit_price: item.unit_price,
      currency: item.currency,
      margin_percent: item.margin_percent,
      total_price: item.total_price,
      material_cost_snapshot: item.material_cost_snapshot,
      material_cost_currency: item.material_cost_currency,
      notes: item.notes,
    }, { transaction });
  }

  return copy;
}

module.exports = { generateBudgetNumber, duplicateBudget };
