const { LoanPayment, Loan, PayrollAdjustment, PayrollEntry } = require('../models');
const sequelize = require('../config/sequelize');

const loanPaymentController = {
  // POST /api/loan-payments
  create: async (req, res) => {
    const transaction = await sequelize.transaction();
    try {
      const { loan_id, payroll_entry_id, amount, exchange_rate, date, notes } = req.body;

      if (!loan_id || !amount || !date) {
        await transaction.rollback();
        return res.status(400).json({ message: 'Missing required fields' });
      }

      const loan = await Loan.findByPk(loan_id, { transaction });
      if (!loan) {
        await transaction.rollback();
        return res.status(404).json({ message: 'Loan not found' });
      }

      const isUSD = loan.currency === 'USD';

      // For USD loans, exchange_rate is required
      if (isUSD && !exchange_rate) {
        await transaction.rollback();
        return res.status(400).json({ message: 'Exchange rate is required for USD loan payments' });
      }

      if (loan.remaining_balance < amount) {
        await transaction.rollback();
        return res.status(400).json({ message: 'Payment amount exceeds remaining balance' });
      }

      // For USD: amount_ars = amount * exchange_rate (converted to ARS for payroll)
      // For ARS: amount_ars = null (amount is already in ARS)
      const amount_ars = isUSD ? amount * exchange_rate : null;

      const payment = await LoanPayment.create({
        loan_id,
        payroll_entry_id,
        amount,
        exchange_rate: isUSD ? exchange_rate : null,
        amount_ars,
        date,
        notes,
        created_by: req.user?.id,
        updated_by: req.user?.id
      }, { transaction });

      // Update Loan Balance
      const newBalance = loan.remaining_balance - amount;
      const newStatus = newBalance <= 0 ? 'completed' : loan.status;

      await loan.update({
        remaining_balance: newBalance,
        status: newStatus
      }, { transaction });

      // If tied to a payroll entry, create the automatic deduction
      if (payroll_entry_id) {
        // Deduction amount is always in ARS (payroll is in ARS)
        const deductionAmount = isUSD ? amount_ars : amount;
        const label = isUSD
          ? `Préstamo cuota USD ${amount} (Cot: $${exchange_rate})`
          : `Préstamo cuota $${amount}`;

        await PayrollAdjustment.create({
          payroll_entry_id,
          label,
          amount: deductionAmount,
          type: 'deduction',
          is_auto: true,
          created_by: req.user?.id,
          updated_by: req.user?.id
        }, { transaction });

        const entry = await PayrollEntry.findByPk(payroll_entry_id, { transaction });
        if (entry) {
          const { PayrollLine } = require('../models');
          const adjustments = await PayrollAdjustment.findAll({ where: { payroll_entry_id: entry.id }, transaction });
          const extras = adjustments.filter(a => a.type === "bonus").reduce((s, a) => s + parseFloat(a.amount), 0);
          const deds = adjustments.filter(a => a.type === "deduction").reduce((s, a) => s + parseFloat(a.amount), 0);
          
          const lines = await PayrollLine.findAll({ where: { payroll_entry_id: entry.id }, transaction });
          let linesGross = 0;
          if (lines.length > 0) {
            linesGross = lines.reduce((s, l) => s + parseFloat(l.subtotal), 0);
          } else {
            linesGross = parseFloat(entry.regular_amount || 0) + parseFloat(entry.overtime_50_amount || 0) + parseFloat(entry.overtime_100_amount || 0);
          }
          const gross_amount = Math.round((linesGross + extras) * 100) / 100;
          const net_amount = Math.round((gross_amount - deds - parseFloat(entry.advances_deducted || 0)) * 100) / 100;
          await entry.update({ gross_amount, net_amount }, { transaction });
        }
      }

      await transaction.commit();
      res.status(201).json(payment);
    } catch (error) {
      await transaction.rollback();
      console.error('Error creating loan payment:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  },

  // DELETE /api/loan-payments/:id
  delete: async (req, res) => {
    const transaction = await sequelize.transaction();
    try {
      const { id } = req.params;
      const payment = await LoanPayment.findByPk(id, { transaction });

      if (!payment) {
        await transaction.rollback();
        return res.status(404).json({ message: 'Loan payment not found' });
      }

      const loan = await Loan.findByPk(payment.loan_id, { transaction });

      // Update loan balance
      const newBalance = Number(loan.remaining_balance) + Number(payment.amount);
      
      await loan.update({
        remaining_balance: newBalance,
        status: 'active' // Always revert to active if a payment is deleted
      }, { transaction });

      // If tied to a payroll entry, we should probably delete the related adjustment 
      // But it's complex to find exactly which one if label changed.
      // Usually, if tied to payroll, the system generated a PayrollAdjustment. 
      // Let's try to delete it based on amount and payroll_entry_id and is_auto
      if (payment.payroll_entry_id) {
        // For USD loans, the adjustment amount was amount_ars; for ARS loans it was amount
        const isUSD = loan.currency === 'USD';
        const adjustmentAmount = isUSD ? payment.amount_ars : payment.amount;

        await PayrollAdjustment.destroy({
          where: {
            payroll_entry_id: payment.payroll_entry_id,
            amount: adjustmentAmount,
            type: 'deduction',
            is_auto: true
          },
          transaction
        });

        const entry = await PayrollEntry.findByPk(payment.payroll_entry_id, { transaction });
        if (entry) {
          const { PayrollLine } = require('../models');
          const adjustments = await PayrollAdjustment.findAll({ where: { payroll_entry_id: entry.id }, transaction });
          const extras = adjustments.filter(a => a.type === "bonus").reduce((s, a) => s + parseFloat(a.amount), 0);
          const deds = adjustments.filter(a => a.type === "deduction").reduce((s, a) => s + parseFloat(a.amount), 0);
          
          const lines = await PayrollLine.findAll({ where: { payroll_entry_id: entry.id }, transaction });
          let linesGross = 0;
          if (lines.length > 0) {
            linesGross = lines.reduce((s, l) => s + parseFloat(l.subtotal), 0);
          } else {
            linesGross = parseFloat(entry.regular_amount || 0) + parseFloat(entry.overtime_50_amount || 0) + parseFloat(entry.overtime_100_amount || 0);
          }
          const gross_amount = Math.round((linesGross + extras) * 100) / 100;
          const net_amount = Math.round((gross_amount - deds - parseFloat(entry.advances_deducted || 0)) * 100) / 100;
          await entry.update({ gross_amount, net_amount }, { transaction });
        }
      }

      await payment.destroy({ transaction });
      await transaction.commit();
      res.status(204).send();
    } catch (error) {
      await transaction.rollback();
      console.error('Error deleting loan payment:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }
};

module.exports = loanPaymentController;
