const db = require("../models");
const { recordAudit } = require("../services/auditLogService");
const { recalculateEntry } = require("./payrollAdjustmentController");

module.exports = {
  getAll: async (req, res) => {
    try {
      const { employee_id, pay_period_id } = req.query;
      const where = {};
      if (employee_id) where.employee_id = employee_id;
      if (pay_period_id) where.pay_period_id = pay_period_id;

      const { count, rows } = await db.SalaryAdvance.findAndCountAll({
        where,
        include: [
          { model: db.Employee, as: "employee", attributes: ["id", "name", "lastname"] },
          { model: db.PayPeriod, as: "payPeriod", attributes: ["id", "month", "year", "type", "status"] },
          { model: db.User, as: "approvedBy", attributes: ["id", "name", "lastname"] },
        ],
        order: [["date", "DESC"]],
      });
      return res.status(200).json({ count, data: rows });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    const { employee_id, employee_ids, amount, date, pay_period_id, notes, payment_method } = req.body;

    if ((!employee_id && (!employee_ids || employee_ids.length === 0)) || !amount || !date || !payment_method) {
      return res.status(400).json({ error: "Empleado(s), monto, fecha y método de pago son obligatorios." });
    }

    const t = await db.sequelize.transaction();
    try {
      const ids = employee_ids || [employee_id];
      const advances = [];

      for (const empId of ids) {
        const employee = await db.Employee.findByPk(empId, { transaction: t });
        if (!employee) {
          await t.rollback();
          return res.status(404).json({ error: `Empleado con ID ${empId} no encontrado.` });
        }

        const advance = await db.SalaryAdvance.create({
          employee_id: empId,
          amount,
          date,
          pay_period_id,
          notes,
          payment_method,
          approved_by: req.user.id,
        }, { transaction: t });

        advances.push(advance);

        await recordAudit({
          entityType: "SalaryAdvance",
          entityId: advance.id,
          action: "create",
          fieldChanged: "amount",
          newValue: advance.amount,
          amount: advance.amount,
          context: { employee_id: empId, pay_period_id: pay_period_id || null, payment_method },
          userId: req.user?.id,
        }, t);
      }

      await t.commit();

      return res.status(201).json({ data: employee_ids ? advances : advances[0] });
    } catch (error) {
      await t.rollback();
      return res.status(500).json({ error: error.message });
    }
  },

  update: async (req, res) => {
    try {
      const advance = await db.SalaryAdvance.findByPk(req.params.id);
      if (!advance) return res.status(404).json({ error: "Adelanto no encontrado." });

      const { amount, date, pay_period_id, notes, payment_method } = req.body;
      const previousAmount = advance.amount;
      await advance.update({ amount, date, pay_period_id, notes, payment_method });

      if (amount !== undefined && String(previousAmount) !== String(advance.amount)) {
        await recordAudit({
          entityType: "SalaryAdvance",
          entityId: advance.id,
          action: "update",
          fieldChanged: "amount",
          previousValue: previousAmount,
          newValue: advance.amount,
          amount: advance.amount,
          context: { employee_id: advance.employee_id, pay_period_id: advance.pay_period_id },
          userId: req.user?.id,
        });
      }

      return res.status(200).json({ data: advance });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  delete: async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
      const advance = await db.SalaryAdvance.findByPk(req.params.id, {
        include: [{ model: db.PayPeriod, as: "payPeriod" }],
        transaction: t,
      });
      if (!advance) {
        await t.rollback();
        return res.status(404).json({ error: "Adelanto no encontrado." });
      }

      if (advance.payPeriod && advance.payPeriod.status !== "open") {
        await t.rollback();
        return res.status(400).json({ error: "No se puede eliminar un adelanto de una quincena cerrada o pagada." });
      }

      const { employee_id, pay_period_id, amount } = advance;

      await recordAudit({
        entityType: "SalaryAdvance",
        entityId: advance.id,
        action: "delete",
        fieldChanged: "amount",
        previousValue: amount,
        amount,
        context: { employee_id, pay_period_id },
        userId: req.user?.id,
      }, t);

      await advance.destroy({ transaction: t });

      if (pay_period_id) {
        const entry = await db.PayrollEntry.findOne({ where: { employee_id, pay_period_id }, transaction: t });
        if (entry) {
          const remaining = await db.SalaryAdvance.findAll({ where: { employee_id, pay_period_id }, transaction: t });
          const advances_deducted = remaining.reduce((sum, a) => sum + parseFloat(a.amount), 0);
          await entry.update({ advances_deducted }, { transaction: t });
          await recalculateEntry(entry.id, t);
        }
      }

      await t.commit();
      return res.status(204).send();
    } catch (error) {
      await t.rollback();
      return res.status(500).json({ error: error.message });
    }
  },
};
