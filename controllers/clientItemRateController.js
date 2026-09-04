const db = require("../models");
const { userHasPermission } = require("../helpers");

/**
 * Tarifa por cliente y rubro de mano de obra (ej. "Hs Grúa" varía según el cliente) — mismo
 * patrón que Material/MaterialCostHistory: valor "actual" en ClientItemRate + historial
 * append-only en ClientItemRateHistory. Montado bajo /clients a propósito (hereda el permiso
 * de ruta clients_read/clients_write) — la tarifa en sí es la misma clase de información
 * protegida que ya cubre budget_prices_read, chequeado a mano en cada handler (mismo criterio
 * que materialController.js#getCostHistory con material_costs_read). Ver FLOWS.md.
 */
module.exports = {
  getAll: async (req, res) => {
    if (!userHasPermission(req.user, "budget_prices_read")) {
      return res.status(403).json({ error: "No tiene permiso para ver tarifas por cliente." });
    }
    try {
      const { id: clientId } = req.params;
      const rates = await db.ClientItemRate.findAll({
        where: { client_id: clientId },
        include: [{ model: db.BudgetItemType, as: "itemType" }],
        order: [[{ model: db.BudgetItemType, as: "itemType" }, "display_order", "ASC"]],
      });
      return res.status(200).json({ data: rates });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  upsert: async (req, res) => {
    if (!userHasPermission(req.user, "budget_prices_read")) {
      return res.status(403).json({ error: "No tiene permiso para cargar tarifas por cliente." });
    }
    const { id: clientId, itemTypeId } = req.params;
    const { current_rate, currency } = req.body;

    if (current_rate === undefined || current_rate === null || !currency) {
      return res.status(400).json({ error: "Tarifa y moneda son obligatorias." });
    }

    const transaction = await db.sequelize.transaction();
    try {
      const client = await db.Client.findByPk(clientId, { transaction });
      if (!client) {
        await transaction.rollback();
        return res.status(404).json({ error: "Cliente no encontrado." });
      }
      const itemType = await db.BudgetItemType.findByPk(itemTypeId, { transaction });
      if (!itemType) {
        await transaction.rollback();
        return res.status(404).json({ error: "Rubro no encontrado." });
      }

      const newRate = parseFloat(current_rate);

      let rateRow = await db.ClientItemRate.findOne({
        where: { client_id: clientId, budget_item_type_id: itemTypeId },
        transaction,
      });

      const changed = !rateRow
        || parseFloat(rateRow.current_rate) !== newRate
        || rateRow.currency !== currency;

      if (changed) {
        await db.ClientItemRateHistory.create({
          client_id: clientId,
          budget_item_type_id: itemTypeId,
          rate: newRate,
          currency,
          changed_by: req.user.id,
        }, { transaction });
      }

      if (rateRow) {
        await rateRow.update({ current_rate: newRate, currency, updated_by: req.user.id }, { transaction });
      } else {
        rateRow = await db.ClientItemRate.create({
          client_id: clientId,
          budget_item_type_id: itemTypeId,
          current_rate: newRate,
          currency,
          updated_by: req.user.id,
        }, { transaction });
      }

      await transaction.commit();

      const fullRate = await db.ClientItemRate.findByPk(rateRow.id, { include: [{ model: db.BudgetItemType, as: "itemType" }] });
      return res.status(200).json({ data: fullRate });
    } catch (error) {
      await transaction.rollback();
      return res.status(500).json({ error: error.message });
    }
  },

  getHistory: async (req, res) => {
    if (!userHasPermission(req.user, "budget_prices_read")) {
      return res.status(403).json({ error: "No tiene permiso para ver el historial de tarifas." });
    }
    try {
      const { id: clientId, itemTypeId } = req.params;
      const history = await db.ClientItemRateHistory.findAll({
        where: { client_id: clientId, budget_item_type_id: itemTypeId },
        include: [{ model: db.User, as: "changedBy", attributes: ["id", "name", "lastname"] }],
        order: [["created_at", "DESC"]],
      });
      return res.status(200).json({ data: history });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
