const { PayrollAdjustment, PayrollEntry, PayrollLine } = require('../models');
const { recordAudit } = require('../services/auditLogService');
const { round2, computeNetAmount, sumAdjustments } = require('../helpers/payrollCalculations');

const ADJUSTMENT_TYPES = ['bonus', 'deduction', 'deposit'];
const invalidTypeMessage = `Tipo de ajuste inválido. Valores permitidos: ${ADJUSTMENT_TYPES.join(', ')}.`;

async function recalculateEntry(payroll_entry_id, transaction) {
  const entry = await PayrollEntry.findByPk(payroll_entry_id, { transaction });
  if (!entry) return;

  const adjustments = await PayrollAdjustment.findAll({ where: { payroll_entry_id: entry.id }, transaction });
  const { extras, deds, deposits } = sumAdjustments(adjustments);

  const lines = await PayrollLine.findAll({ where: { payroll_entry_id: entry.id }, transaction });
  let linesGross = 0;
  if (lines.length > 0) {
    linesGross = lines.reduce((s, l) => s + parseFloat(l.subtotal), 0);
  } else {
    linesGross = parseFloat(entry.regular_amount || 0) + parseFloat(entry.overtime_50_amount || 0) + parseFloat(entry.overtime_100_amount || 0);
  }
  const gross_amount = round2(linesGross + extras);
  const net_amount = computeNetAmount({
    gross_amount,
    deds,
    deposits,
    advances_deducted: entry.advances_deducted,
    loan_installments_deducted: entry.loan_installments_deducted,
  });
  await entry.update({ gross_amount, net_amount }, { transaction });
}

const payrollAdjustmentController = {
  // GET /api/payroll-adjustments?payroll_entry_id=1
  getAll: async (req, res) => {
    try {
      const { payroll_entry_id } = req.query;
      const whereClause = {};
      
      if (payroll_entry_id) {
        whereClause.payroll_entry_id = payroll_entry_id;
      }

      const adjustments = await PayrollAdjustment.findAll({
        where: whereClause,
        order: [['createdAt', 'ASC']]
      });
      res.status(200).json(adjustments);
    } catch (error) {
      console.error('Error fetching payroll adjustments:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  },

  // POST /api/payroll-adjustments
  create: async (req, res) => {
    try {
      const { payroll_entry_id, label, amount, type, is_remunerative } = req.body;

      if (!payroll_entry_id || !label || amount === undefined || !type) {
        return res.status(400).json({ message: 'Missing required fields' });
      }
      if (!ADJUSTMENT_TYPES.includes(type)) {
        return res.status(400).json({ message: invalidTypeMessage });
      }

      const entry = await PayrollEntry.findByPk(payroll_entry_id);
      if (!entry) {
        return res.status(404).json({ message: 'Payroll entry not found' });
      }
      if (entry.status === 'paid') {
        return res.status(400).json({ message: 'No se puede editar una liquidación ya pagada.' });
      }

      const adjustment = await PayrollAdjustment.create({
        payroll_entry_id,
        label,
        amount,
        type,
        // Solo los premios pueden ser no remunerativos; el resto siempre queda en true.
        is_remunerative: type === 'bonus' ? is_remunerative !== false : true,
        is_auto: false, // Manual by definition
        created_by: req.user?.id,
        updated_by: req.user?.id
      });

      await recalculateEntry(payroll_entry_id);

      await recordAudit({
        entityType: 'PayrollAdjustment',
        entityId: adjustment.id,
        action: 'create',
        fieldChanged: 'amount',
        newValue: adjustment.amount,
        amount: adjustment.amount,
        context: { payroll_entry_id, label, type, is_remunerative: adjustment.is_remunerative },
        userId: req.user?.id,
      });

      res.status(201).json(adjustment);
    } catch (error) {
      console.error('Error creating payroll adjustment:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  },

  // PUT /api/payroll-adjustments/:id
  update: async (req, res) => {
    try {
      const { id } = req.params;
      const { label, amount, type, is_remunerative } = req.body;

      if (type !== undefined && !ADJUSTMENT_TYPES.includes(type)) {
        return res.status(400).json({ message: invalidTypeMessage });
      }

      const adjustment = await PayrollAdjustment.findByPk(id);

      if (!adjustment) {
        return res.status(404).json({ message: 'Adjustment not found' });
      }
      
      if (adjustment.is_auto) {
        return res.status(400).json({ message: 'Cannot manually edit automatic adjustments' });
      }

      const entry = await PayrollEntry.findByPk(adjustment.payroll_entry_id);
      if (entry && entry.status === 'paid') {
        return res.status(400).json({ message: 'No se puede editar una liquidación ya pagada.' });
      }

      const previousAmount = adjustment.amount;
      const previousRemunerative = adjustment.is_remunerative;
      const finalType = type || adjustment.type;

      // Cambiar si un premio integra o no la base del aguinaldo solo se permite con la
      // liquidación en borrador: una confirmada ya alimenta el cálculo del SAC.
      const remunerativeChange = is_remunerative !== undefined && finalType === 'bonus' && Boolean(is_remunerative) !== previousRemunerative;
      if (remunerativeChange && entry && entry.status !== 'draft') {
        return res.status(400).json({ message: 'Solo se puede cambiar si un premio es remunerativo con la liquidación en borrador.' });
      }

      await adjustment.update({
        label: label || adjustment.label,
        amount: amount !== undefined ? amount : adjustment.amount,
        type: finalType,
        // Un ajuste que deja de ser premio vuelve a remunerativo (el campo no aplica).
        is_remunerative: finalType === 'bonus'
          ? (is_remunerative !== undefined ? Boolean(is_remunerative) : adjustment.is_remunerative)
          : true,
        updated_by: req.user?.id
      });

      if (remunerativeChange) {
        await recordAudit({
          entityType: 'PayrollAdjustment',
          entityId: adjustment.id,
          action: 'update',
          fieldChanged: 'is_remunerative',
          previousValue: previousRemunerative,
          newValue: adjustment.is_remunerative,
          context: { payroll_entry_id: adjustment.payroll_entry_id, label: adjustment.label, type: adjustment.type },
          userId: req.user?.id,
        });
      }

      if (amount !== undefined && String(previousAmount) !== String(adjustment.amount)) {
        await recordAudit({
          entityType: 'PayrollAdjustment',
          entityId: adjustment.id,
          action: 'update',
          fieldChanged: 'amount',
          previousValue: previousAmount,
          newValue: adjustment.amount,
          amount: adjustment.amount,
          context: { payroll_entry_id: adjustment.payroll_entry_id, label: adjustment.label, type: adjustment.type },
          userId: req.user?.id,
        });
      }

      await recalculateEntry(adjustment.payroll_entry_id);

      res.status(200).json(adjustment);
    } catch (error) {
      console.error('Error updating payroll adjustment:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  },

  // DELETE /api/payroll-adjustments/:id
  delete: async (req, res) => {
    try {
      const { id } = req.params;
      const adjustment = await PayrollAdjustment.findByPk(id);

      if (!adjustment) {
        return res.status(404).json({ message: 'Adjustment not found' });
      }

      if (adjustment.is_auto) {
        return res.status(400).json({ message: 'Cannot manually delete automatic adjustments' });
      }

      const entry = await PayrollEntry.findByPk(adjustment.payroll_entry_id);
      if (entry && entry.status === 'paid') {
        return res.status(400).json({ message: 'No se puede editar una liquidación ya pagada.' });
      }

      const payroll_entry_id = adjustment.payroll_entry_id;

      await recordAudit({
        entityType: 'PayrollAdjustment',
        entityId: adjustment.id,
        action: 'delete',
        fieldChanged: 'amount',
        previousValue: adjustment.amount,
        amount: adjustment.amount,
        context: { payroll_entry_id, label: adjustment.label, type: adjustment.type },
        userId: req.user?.id,
      });

      await adjustment.destroy();
      await recalculateEntry(payroll_entry_id);

      res.status(204).send();
    } catch (error) {
      console.error('Error deleting payroll adjustment:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }
};

module.exports = payrollAdjustmentController;
module.exports.recalculateEntry = recalculateEntry;
