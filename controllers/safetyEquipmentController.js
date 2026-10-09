const db = require("../models");
const { Op } = require("sequelize");
const { addMonths, uploadToR2 } = require("../helpers");

const buildSignatureFields = async (file) => {
  if (!file) return { signature_url: null, signature_key: null, signature_name: null };
  const url = await uploadToR2(file, "signatures/safety-equipment");
  return {
    signature_url: url,
    signature_key: url.replace(`${process.env.STORAGE_PUBLIC_URL}/`, ""),
    signature_name: file.originalname,
  };
};

// `status` no se puede filtrar en SQL porque `computed_status` es un VIRTUAL (se calcula en
// cada lectura, no se persiste — ver models/safetyEquipment.js), así que se filtra en JS después
// de aplicar el resto de los filtros en la consulta. La tabla es chica (no hay paginación en
// ningún listado del repo) así que no es un problema de performance.
function matchesStatus(record, status) {
  switch (status) {
    case "current": return record.alert_status !== "renewed";
    case "renewed": return record.alert_status === "renewed";
    case "permanent": return !record.expiration_date;
    case "expired": return record.computed_status === "expired";
    case "expiring_soon": return record.computed_status === "expiring_soon";
    case "alert": return record.computed_status === "expired" || record.computed_status === "expiring_soon";
    default: return true;
  }
}

module.exports = {
  getAll: async (req, res) => {
    try {
      const { employee_id, epp_item_id, category, date_from, date_to, status } = req.query;
      const where = {};
      if (employee_id) where.employee_id = employee_id;
      if (epp_item_id) {
        where.epp_item_id = epp_item_id;
      } else if (category) {
        const itemsInCategory = await db.EppItem.findAll({ where: { category }, attributes: ["id"] });
        where.epp_item_id = { [Op.in]: itemsInCategory.map((i) => i.id) };
      }
      if (date_from || date_to) {
        where.delivered_date = {};
        if (date_from) where.delivered_date[Op.gte] = date_from;
        if (date_to) where.delivered_date[Op.lte] = date_to;
      }

      const rows = await db.SafetyEquipment.findAll({
        where,
        include: [
          { model: db.Employee, as: "employee", attributes: ["id", "name", "lastname"] },
          { model: db.EppItem, as: "eppItem", attributes: ["id", "name", "category", "size_type"] },
          { model: db.User, as: "deliveredBy", attributes: ["id", "name", "lastname"] },
        ],
        order: [["delivered_date", "DESC"]],
      });

      const data = status ? rows.filter((r) => matchesStatus(r, status)) : rows;
      return res.status(200).json({ count: data.length, data });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    const { employee_id, epp_item_id, size_delivered, quantity, delivered_date, condition, notes } = req.body;
    // `expiration_date` puede venir: ausente (se calcula de la vida útil del artículo), con una
    // fecha (el usuario la editó), o explícitamente null (checkbox "Sin vencimiento").
    const expirationProvided = Object.prototype.hasOwnProperty.call(req.body, "expiration_date");
    const providedExpirationDate = req.body.expiration_date || null;

    if (!employee_id || !epp_item_id || !delivered_date) {
      return res.status(400).json({ error: "Empleado, artículo y fecha de entrega son obligatorios." });
    }

    const transaction = await db.sequelize.transaction();
    try {
      const employee = await db.Employee.findByPk(employee_id, { transaction });
      if (!employee) {
        await transaction.rollback();
        return res.status(404).json({ error: "Empleado no encontrado." });
      }

      const eppItem = await db.EppItem.findByPk(epp_item_id, { transaction });
      if (!eppItem) {
        await transaction.rollback();
        return res.status(404).json({ error: "Artículo de EPP no encontrado." });
      }

      const expiration_date = expirationProvided
        ? providedExpirationDate
        : (eppItem.lifespan_months ? addMonths(delivered_date, eppItem.lifespan_months) : null);
      const notify_days_before = eppItem.notify_days_before || 15;

      let previous_record_id = null;
      if (expiration_date) {
        const previous = await db.SafetyEquipment.findOne({
          where: { employee_id, epp_item_id, alert_status: { [Op.ne]: "renewed" } },
          order: [["delivered_date", "DESC"], ["id", "DESC"]],
          transaction,
        });
        if (previous && previous.expiration_date) {
          previous_record_id = previous.id;
          await previous.update(
            { alert_status: "renewed", renewed_at: new Date(), renewed_by: req.user.id },
            { transaction }
          );
        }
      }

      const signatureFields = await buildSignatureFields(req.file);

      const item = await db.SafetyEquipment.create({
        employee_id,
        epp_item_id,
        size_delivered: size_delivered || null,
        quantity: quantity || 1,
        delivered_date,
        expiration_date,
        notify_days_before,
        previous_record_id,
        condition,
        notes,
        ...signatureFields,
        delivered_by: req.user.id,
      }, { transaction });

      await transaction.commit();

      // Reload with associations for the response
      const created = await db.SafetyEquipment.findByPk(item.id, {
        include: [
          { model: db.Employee, as: "employee", attributes: ["id", "name", "lastname"] },
          { model: db.EppItem, as: "eppItem", attributes: ["id", "name", "category", "size_type"] },
          { model: db.User, as: "deliveredBy", attributes: ["id", "name", "lastname"] },
        ],
      });

      return res.status(201).json({ data: created });
    } catch (error) {
      await transaction.rollback();
      return res.status(500).json({ error: error.message });
    }
  },

  update: async (req, res) => {
    try {
      const item = await db.SafetyEquipment.findByPk(req.params.id);
      if (!item) return res.status(404).json({ error: "Registro no encontrado." });

      const { epp_item_id, size_delivered, quantity, delivered_date, return_date, expiration_date, condition, notes } = req.body;
      const updates = { epp_item_id, size_delivered, quantity, delivered_date, return_date, expiration_date, condition, notes };
      // Mismo criterio que documentController.update: si cambia el vencimiento, el estado de
      // aviso vuelve a "pending" (si no, un vencimiento movido hacia adelante seguiría marcado
      // como vencido/avisado).
      if (expiration_date !== undefined && expiration_date !== item.expiration_date) {
        updates.alert_status = "pending";
      }
      Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key]);

      await item.update(updates);

      const updated = await db.SafetyEquipment.findByPk(item.id, {
        include: [
          { model: db.Employee, as: "employee", attributes: ["id", "name", "lastname"] },
          { model: db.EppItem, as: "eppItem", attributes: ["id", "name", "category", "size_type"] },
          { model: db.User, as: "deliveredBy", attributes: ["id", "name", "lastname"] },
        ],
      });

      return res.status(200).json({ data: updated });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
