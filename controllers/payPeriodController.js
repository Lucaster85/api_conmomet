const { Op } = require("sequelize");
const db = require("../models");
const { computeNetAmount, sumAdjustments, round2 } = require("../helpers/payrollCalculations");
const { getUsdRateConfig } = require("../helpers/systemSettings");
const { rateDateForPeriod, fetchUsdRateForDate, fetchCurrentUsdRate } = require("../services/exchangeRateService");

// LoanPayments con exchange_rate no nulo son, por construcción, cuotas de préstamos en USD (ver
// payrollController#generate) — tanto las automáticas de cuota fija como una eventual manual.
async function findUsdLoanPaymentsOfPeriod(periodId, transaction) {
  return db.LoanPayment.findAll({
    where: { exchange_rate: { [Op.ne]: null } },
    include: [{ model: db.PayrollEntry, as: "payrollEntry", where: { pay_period_id: periodId }, attributes: ["id"] }],
    transaction,
  });
}

// Recalcula gross/net de una liquidación a partir de sus líneas y ajustes actuales — mismo patrón
// que payrollAdjustmentController#recalculateEntry, acá solo cambia loan_installments_deducted.
async function recalculateEntryLoanDeduction(entryId, transaction) {
  const entry = await db.PayrollEntry.findByPk(entryId, { transaction });
  if (!entry) return;

  const loanDeductionRows = await db.LoanPayment.findAll({
    where: { payroll_entry_id: entryId, loan_installment_id: { [Op.ne]: null } },
    transaction,
  });
  const loan_installments_deducted = round2(
    loanDeductionRows.reduce((sum, p) => sum + (p.amount_ars != null ? Number(p.amount_ars) : Number(p.amount)), 0)
  );

  const adjustments = await db.PayrollAdjustment.findAll({ where: { payroll_entry_id: entryId }, transaction });
  const { deds, deposits } = sumAdjustments(adjustments);
  const net_amount = computeNetAmount({
    gross_amount: entry.gross_amount,
    deds,
    deposits,
    advances_deducted: entry.advances_deducted,
    loan_installments_deducted,
  });

  await entry.update({ loan_installments_deducted, net_amount }, { transaction });
}

module.exports = {
  getAll: async (req, res) => {
    try {
      const { year, status } = req.query;
      const where = {};
      if (year) where.year = year;
      if (status) where.status = status;

      const { count, rows } = await db.PayPeriod.findAndCountAll({
        where,
        include: [{ model: db.User, as: "closedBy", attributes: ["id", "name", "lastname"] }],
        order: [["year", "DESC"], ["month", "DESC"], ["type", "DESC"]],
      });
      return res.status(200).json({ count, data: rows });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    const { month, year, type } = req.body;

    if (!month || !year || !type) {
      return res.status(400).json({ error: "Mes, año y tipo son obligatorios." });
    }

    try {
      // Calculate dates
      const lastDay = new Date(year, month, 0).getDate();
      const start_date = type === "first_half" ? `${year}-${String(month).padStart(2, "0")}-01` : `${year}-${String(month).padStart(2, "0")}-16`;
      const end_date = type === "first_half" ? `${year}-${String(month).padStart(2, "0")}-15` : `${year}-${String(month).padStart(2, "0")}-${lastDay}`;

      // Check if already exists
      const existing = await db.PayPeriod.findOne({ where: { month, year, type } });
      if (existing) return res.status(400).json({ error: "Ya existe una quincena para ese período." });

      const period = await db.PayPeriod.create({ start_date, end_date, type, month, year });
      return res.status(201).json({ data: period });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // GET /pay-periods/:id/usd-rate-preview — lo consume el diálogo de cierre para mostrar, antes
  // de confirmar, qué cotización se va a congelar y a cuántos empleados afecta.
  usdRatePreview: async (req, res) => {
    try {
      const period = await db.PayPeriod.findByPk(req.params.id);
      if (!period) return res.status(404).json({ error: "Quincena no encontrada." });

      const config = await getUsdRateConfig();
      const ruleDate = rateDateForPeriod(period);
      const definitive = await fetchUsdRateForDate(ruleDate, config);
      const current = definitive ? null : await fetchCurrentUsdRate(config);

      const usdLoanPayments = await findUsdLoanPaymentsOfPeriod(period.id);
      const affectedEntryIds = new Set(usdLoanPayments.map((p) => p.payroll_entry_id));
      const affected_total_usd = round2(usdLoanPayments.reduce((s, p) => s + Number(p.amount), 0));

      const suggested_rate = definitive ? definitive.rate : (current ? current.rate : (period.usd_exchange_rate ? Number(period.usd_exchange_rate) : null));
      const source = definitive ? "api" : (current ? "api" : (period.usd_exchange_rate ? period.usd_exchange_rate_source : null));
      const currentAppliedRate = period.usd_exchange_rate ? Number(period.usd_exchange_rate) : null;
      const estimated_delta_ars = (suggested_rate != null && currentAppliedRate != null && suggested_rate !== currentAppliedRate)
        ? round2(affected_total_usd * (suggested_rate - currentAppliedRate))
        : 0;

      return res.status(200).json({
        data: {
          rate_date: ruleDate,
          suggested_rate,
          source,
          rate_date_published: !!definitive,
          provisional_rate: current ? current.rate : null,
          casa: config.casa,
          side: config.side,
          affected_entries: affectedEntryIds.size,
          affected_total_usd,
          estimated_delta_ars,
        },
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // PUT /pay-periods/:id/usd-rate — carga manual de la cotización en una quincena abierta (el
  // escape cuando la API falla al generar o la fecha de la regla todavía no se publicó).
  setUsdRate: async (req, res) => {
    try {
      const period = await db.PayPeriod.findByPk(req.params.id);
      if (!period) return res.status(404).json({ error: "Quincena no encontrada." });
      if (period.status !== "open") return res.status(400).json({ error: "Solo se puede cargar la cotización a mano en una quincena abierta." });

      const rate = Number(req.body.usd_exchange_rate);
      if (!(rate > 0)) return res.status(400).json({ error: "La cotización debe ser mayor a cero." });

      await period.update({
        usd_exchange_rate: rate,
        usd_exchange_rate_date: rateDateForPeriod(period),
        usd_exchange_rate_source: "manual",
        usd_exchange_rate_locked_at: null,
      });

      return res.status(200).json({ data: period });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  close: async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
      const period = await db.PayPeriod.findByPk(req.params.id, { transaction: t });
      if (!period) {
        await t.rollback();
        return res.status(404).json({ error: "Quincena no encontrada." });
      }
      if (period.status !== "open") {
        await t.rollback();
        return res.status(400).json({ error: "Solo se pueden cerrar quincenas abiertas." });
      }

      const usdLoanPayments = await findUsdLoanPaymentsOfPeriod(period.id, t);

      if (usdLoanPayments.length > 0) {
        const manualRate = req.body?.usd_exchange_rate;
        let finalRate;
        let finalDate;
        let finalSource;

        if (manualRate !== undefined && manualRate !== null && manualRate !== "") {
          finalRate = Number(manualRate);
          if (!(finalRate > 0)) {
            await t.rollback();
            return res.status(400).json({ error: "La cotización debe ser mayor a cero." });
          }
          finalDate = rateDateForPeriod(period);
          finalSource = "manual";
        } else {
          const config = await getUsdRateConfig();
          const ruleDate = rateDateForPeriod(period);
          const definitive = await fetchUsdRateForDate(ruleDate, config);
          if (definitive) {
            finalRate = definitive.rate;
            finalDate = definitive.date;
            finalSource = "api";
          } else if (period.usd_exchange_rate) {
            // Provisoria ya cargada (automática o manual) y la definitiva todavía no publicó.
            finalRate = Number(period.usd_exchange_rate);
            finalDate = period.usd_exchange_rate_date;
            finalSource = period.usd_exchange_rate_source;
          } else {
            await t.rollback();
            return res.status(400).json({ error: "No se pudo obtener la cotización del dólar; cargala a mano para poder cerrar la quincena." });
          }
        }

        await period.update({
          usd_exchange_rate: finalRate,
          usd_exchange_rate_date: finalDate,
          usd_exchange_rate_source: finalSource,
          usd_exchange_rate_locked_at: new Date(),
        }, { transaction: t });

        // Recalcular solo los pagos cuya cotización quedó desactualizada frente a la final.
        const affectedEntryIds = new Set();
        for (const payment of usdLoanPayments) {
          if (Number(payment.exchange_rate) === finalRate) continue;
          const newAmountArs = round2(Number(payment.amount) * finalRate);
          const noteBase = payment.notes.replace(/\s*\(Cot: \$[\d.,]+\)\s*$/, "");
          await payment.update({
            exchange_rate: finalRate,
            amount_ars: newAmountArs,
            notes: `${noteBase} (Cot: $${finalRate})`,
          }, { transaction: t });
          if (payment.payroll_entry_id) affectedEntryIds.add(payment.payroll_entry_id);
        }

        for (const entryId of affectedEntryIds) {
          await recalculateEntryLoanDeduction(entryId, t);
        }
      }

      await period.update({
        status: "closed",
        closed_by: req.user.id,
        closed_at: new Date(),
      }, { transaction: t });

      // Lock rate changes: mark applied retroactives as confirmed (immutable)
      await db.RateChange.update(
        { status: "confirmed" },
        { where: { applied_in_period: period.id, status: "applied" }, transaction: t }
      );

      await t.commit();
      return res.status(200).json({ data: period });
    } catch (error) {
      await t.rollback();
      return res.status(500).json({ error: error.message });
    }
  },

  pay: async (req, res) => {
    try {
      const period = await db.PayPeriod.findByPk(req.params.id);
      if (!period) return res.status(404).json({ error: "Quincena no encontrada." });
      if (period.status !== "closed") return res.status(400).json({ error: "Solo se pueden pagar quincenas cerradas." });

      await period.update({ status: "paid" });

      // Mark all draft/confirmed payroll entries as paid
      await db.PayrollEntry.update(
        { status: "paid", paid_at: new Date() },
        { where: { pay_period_id: period.id, status: { [Op.ne]: "paid" } } }
      );

      return res.status(200).json({ data: period });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
