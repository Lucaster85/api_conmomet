const db = require("../models");
const { Op } = require("sequelize");
const { recordAudit } = require("../services/auditLogService");

module.exports = {
  getAll: async (req, res) => {
    try {
      const { employee_id, pay_period_id, status, paid } = req.query;
      const where = {};
      if (employee_id) where.employee_id = employee_id;
      if (pay_period_id) where.pay_period_id = pay_period_id;
      if (status) where.status = status;
      if (paid === "true") where.paid_at = { [Op.ne]: null };
      if (paid === "false") where.paid_at = null;

      const { count, rows } = await db.SalaryAdvance.findAndCountAll({
        where,
        include: [
          { model: db.Employee, as: "employee", attributes: ["id", "name", "lastname"] },
          { model: db.PayPeriod, as: "payPeriod", attributes: ["id", "month", "year", "type"] },
          { model: db.User, as: "approvedBy", attributes: ["id", "name", "lastname"] },
        ],
        order: [["date", "DESC"]],
      });

      const pendingKeys = rows.filter((r) => r.status === "pending").map((r) => `${r.employee_id}:${r.pay_period_id}`);
      let conflictKeys = new Set();
      if (pendingKeys.length > 0) {
        const pairs = [...new Set(pendingKeys)].map((k) => {
          const [empId, periodId] = k.split(":");
          return { employee_id: Number(empId), pay_period_id: periodId === "null" ? null : Number(periodId) };
        });

        for (const pair of pairs) {
          const siblingCount = await db.SalaryAdvance.count({
            where: {
              employee_id: pair.employee_id,
              pay_period_id: pair.pay_period_id,
              status: { [Op.ne]: "rejected" },
            },
          });
          if (siblingCount > 1) conflictKeys.add(`${pair.employee_id}:${pair.pay_period_id}`);
        }
      }

      const data = rows.map((r) => {
        const json = r.toJSON();
        const key = `${json.employee_id}:${json.pay_period_id}`;
        json.conflict_warning = (json.status === "pending" && conflictKeys.has(key))
          ? "El empleado ya tiene otro adelanto en esta quincena"
          : null;
        return json;
      });

      return res.status(200).json({ count, data });
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
          status: "approved",
          approved_by: req.user.id,
          approved_at: new Date(),
          paid_at: new Date(),
          paid_by: req.user.id,
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

  approve: async (req, res) => {
    try {
      const advance = await db.SalaryAdvance.findByPk(req.params.id);
      if (!advance) return res.status(404).json({ error: "Adelanto no encontrado." });
      if (advance.status !== "pending") {
        return res.status(400).json({ error: `No se puede aprobar un adelanto en estado: ${advance.status}` });
      }

      const { amount, payment_method, pay_period_id, mark_as_paid } = req.body;
      const isPaidNow = !!mark_as_paid;

      await advance.update({
        amount: amount !== undefined && amount !== null && amount !== "" ? amount : advance.amount,
        payment_method: payment_method || advance.payment_method || "transferencia",
        pay_period_id: pay_period_id !== undefined ? pay_period_id : advance.pay_period_id,
        status: "approved",
        approved_by: req.user.id,
        approved_at: new Date(),
        paid_at: isPaidNow ? new Date() : null,
        paid_by: isPaidNow ? req.user.id : null,
      });

      await recordAudit({
        entityType: "SalaryAdvance",
        entityId: advance.id,
        action: "update",
        fieldChanged: "status",
        previousValue: "pending",
        newValue: "approved",
        amount: advance.amount,
        context: { employee_id: advance.employee_id, pay_period_id: advance.pay_period_id, paid: isPaidNow },
        userId: req.user?.id,
      });

      return res.status(200).json({ data: advance });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  markAsPaid: async (req, res) => {
    try {
      const { payment_method } = req.body;
      if (!payment_method) {
        return res.status(400).json({ error: "El método de pago es obligatorio." });
      }

      const advance = await db.SalaryAdvance.findByPk(req.params.id);
      if (!advance) return res.status(404).json({ error: "Adelanto no encontrado." });
      if (advance.status !== "approved") {
        return res.status(400).json({ error: `No se puede marcar como pagado un adelanto en estado: ${advance.status}` });
      }
      if (advance.paid_at) {
        return res.status(400).json({ error: "Este adelanto ya está marcado como pagado." });
      }

      await advance.update({
        payment_method,
        paid_at: new Date(),
        paid_by: req.user.id,
      });

      await recordAudit({
        entityType: "SalaryAdvance",
        entityId: advance.id,
        action: "update",
        fieldChanged: "paid_at",
        newValue: advance.paid_at,
        amount: advance.amount,
        context: { employee_id: advance.employee_id, pay_period_id: advance.pay_period_id },
        userId: req.user?.id,
      });

      return res.status(200).json({ data: advance });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  reject: async (req, res) => {
    try {
      const advance = await db.SalaryAdvance.findByPk(req.params.id);
      if (!advance) return res.status(404).json({ error: "Adelanto no encontrado." });
      if (advance.status !== "pending") {
        return res.status(400).json({ error: `No se puede rechazar un adelanto en estado: ${advance.status}` });
      }

      await advance.update({
        status: "rejected",
        notes: req.body.notes ? `${advance.notes || ''}\nRechazo: ${req.body.notes}` : advance.notes,
      });

      await recordAudit({
        entityType: "SalaryAdvance",
        entityId: advance.id,
        action: "update",
        fieldChanged: "status",
        previousValue: "pending",
        newValue: "rejected",
        context: { employee_id: advance.employee_id, pay_period_id: advance.pay_period_id },
        userId: req.user?.id,
      });

      return res.status(200).json({ data: advance });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
