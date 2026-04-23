const { Op } = require("sequelize");
const db = require("../models");

module.exports = {
  /**
   * Get all payroll entries for a pay period.
   */
  getByPeriod: async (req, res) => {
    try {
      const period = await db.PayPeriod.findByPk(req.params.payPeriodId);
      if (!period) return res.status(404).json({ error: "Quincena no encontrada." });

      const entries = await db.PayrollEntry.findAll({
        where: { pay_period_id: period.id },
        include: [{ model: db.Employee, as: "employee", attributes: ["id", "name", "lastname", "dni", "hourly_rate", "position"] }],
        order: [["employee_id", "ASC"]],
      });

      return res.status(200).json({ count: entries.length, data: entries, period });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  /**
   * Generate payroll entries for all active employees in a pay period.
   * Sums approved TimeEntries and calculates amounts.
   */
  generate: async (req, res) => {
    try {
      const period = await db.PayPeriod.findByPk(req.params.payPeriodId);
      if (!period) return res.status(404).json({ error: "Quincena no encontrada." });
      if (period.status !== "open") return res.status(400).json({ error: "Solo se puede generar liquidación para quincenas abiertas." });

      const employees = await db.Employee.findAll({ where: { status: "active" } });
      const generated = [];

      for (const emp of employees) {
        // Check if already generated
        const existing = await db.PayrollEntry.findOne({
          where: { pay_period_id: period.id, employee_id: emp.id },
        });
        if (existing) continue;

        // Sum approved time entries for this period
        const timeEntries = await db.TimeEntry.findAll({
          where: {
            employee_id: emp.id,
            date: { [Op.between]: [period.start_date, period.end_date] },
            status: "approved",
          },
        });

        const total_regular_hours = timeEntries.reduce((sum, te) => sum + parseFloat(te.regular_hours || 0), 0);
        const total_overtime_50_hours = timeEntries.reduce((sum, te) => sum + parseFloat(te.overtime_50_hours || 0), 0);
        const total_overtime_100_hours = timeEntries.reduce((sum, te) => sum + parseFloat(te.overtime_100_hours || 0), 0);
        const late_count = timeEntries.filter(te => te.is_late).length;

        const hourly_rate = parseFloat(emp.hourly_rate);
        const regular_amount = Math.round(total_regular_hours * hourly_rate * 100) / 100;
        const overtime_50_amount = Math.round(total_overtime_50_hours * hourly_rate * 1.5 * 100) / 100;
        const overtime_100_amount = Math.round(total_overtime_100_hours * hourly_rate * 2.0 * 100) / 100;

        // Count absences
        const absences = await db.Attendance.count({
          where: {
            employee_id: emp.id,
            date: { [Op.between]: [period.start_date, period.end_date] },
            status: "absent",
          },
        });

        // Sum advances for this period
        const advances = await db.SalaryAdvance.findAll({
          where: {
            employee_id: emp.id,
            [Op.or]: [
              { pay_period_id: period.id },
              { pay_period_id: null, date: { [Op.between]: [period.start_date, period.end_date] } },
            ],
          },
        });
        const advances_deducted = advances.reduce((sum, a) => sum + parseFloat(a.amount), 0);

        // Link unassigned advances to this period
        const unassignedIds = advances.filter(a => !a.pay_period_id).map(a => a.id);
        if (unassignedIds.length > 0) {
          await db.SalaryAdvance.update(
            { pay_period_id: period.id },
            { where: { id: unassignedIds } }
          );
        }

        const gross_amount = regular_amount + overtime_50_amount + overtime_100_amount;
        const net_amount = Math.round((gross_amount - advances_deducted) * 100) / 100;

        const entry = await db.PayrollEntry.create({
          pay_period_id: period.id,
          employee_id: emp.id,
          total_regular_hours: Math.round(total_regular_hours * 100) / 100,
          total_overtime_50_hours: Math.round(total_overtime_50_hours * 100) / 100,
          total_overtime_100_hours: Math.round(total_overtime_100_hours * 100) / 100,
          regular_amount,
          overtime_50_amount,
          overtime_100_amount,
          gross_amount,
          advances_deducted,
          net_amount,
          late_count,
          absent_count: absences,
        });

        generated.push(entry);
      }

      return res.status(201).json({ count: generated.length, data: generated });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  /**
   * Update a payroll entry manually (extra payments, deductions, notes).
   */
  update: async (req, res) => {
    try {
      const entry = await db.PayrollEntry.findByPk(req.params.id);
      if (!entry) return res.status(404).json({ error: "Liquidación no encontrada." });
      if (entry.status === "paid") return res.status(400).json({ error: "No se puede editar una liquidación ya pagada." });

      const { extra_payments, extra_payments_notes, deductions, deductions_notes, notes } = req.body;

      const extras = extra_payments !== undefined ? parseFloat(extra_payments) : parseFloat(entry.extra_payments);
      const deds = deductions !== undefined ? parseFloat(deductions) : parseFloat(entry.deductions);

      const gross_amount = parseFloat(entry.regular_amount) + parseFloat(entry.overtime_50_amount) + parseFloat(entry.overtime_100_amount) + extras;
      const net_amount = Math.round((gross_amount - deds - parseFloat(entry.advances_deducted)) * 100) / 100;

      await entry.update({
        extra_payments: extras,
        extra_payments_notes: extra_payments_notes !== undefined ? extra_payments_notes : entry.extra_payments_notes,
        deductions: deds,
        deductions_notes: deductions_notes !== undefined ? deductions_notes : entry.deductions_notes,
        gross_amount: Math.round(gross_amount * 100) / 100,
        net_amount,
        notes: notes !== undefined ? notes : entry.notes,
      });

      return res.status(200).json({ data: entry });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  confirm: async (req, res) => {
    try {
      const entry = await db.PayrollEntry.findByPk(req.params.id);
      if (!entry) return res.status(404).json({ error: "Liquidación no encontrada." });
      if (entry.status !== "draft") return res.status(400).json({ error: "Solo se pueden confirmar liquidaciones en borrador." });

      await entry.update({ status: "confirmed" });
      return res.status(200).json({ data: entry });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  pay: async (req, res) => {
    try {
      const entry = await db.PayrollEntry.findByPk(req.params.id);
      if (!entry) return res.status(404).json({ error: "Liquidación no encontrada." });
      if (entry.status !== "confirmed") return res.status(400).json({ error: "La liquidación debe estar confirmada para poder pagarse." });

      await entry.update({ status: "paid", paid_at: new Date() });
      return res.status(200).json({ data: entry });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
