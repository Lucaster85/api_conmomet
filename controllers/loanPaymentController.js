const { LoanPayment, Loan, PayrollAdjustment, PayrollEntry } = require('../models');
const sequelize = require('../config/sequelize');

const loanPaymentController = {
  // POST /api/loan-payments
  create: async (req, res) => {
    const transaction = await sequelize.transaction();
    try {
      const { loan_id, payroll_entry_id, amount_usd, exchange_rate, date, notes } = req.body;

      if (!loan_id || !amount_usd || !exchange_rate || !date) {
        await transaction.rollback();
        return res.status(400).json({ message: 'Missing required fields' });
      }

      const loan = await Loan.findByPk(loan_id, { transaction });
      if (!loan) {
        await transaction.rollback();
        return res.status(404).json({ message: 'Loan not found' });
      }

      if (loan.remaining_balance_usd < amount_usd) {
        await transaction.rollback();
        return res.status(400).json({ message: 'Payment amount exceeds remaining balance' });
      }

      const amount_ars = amount_usd * exchange_rate;

      const payment = await LoanPayment.create({
        loan_id,
        payroll_entry_id,
        amount_usd,
        exchange_rate,
        amount_ars,
        date,
        notes,
        created_by: req.user?.id,
        updated_by: req.user?.id
      }, { transaction });

      // Update Loan Balance
      const newBalance = loan.remaining_balance_usd - amount_usd;
      const newStatus = newBalance <= 0 ? 'completed' : loan.status;

      await loan.update({
        remaining_balance_usd: newBalance,
        status: newStatus
      }, { transaction });

      // If tied to a payroll entry, create the automatic deduction
      if (payroll_entry_id) {
        await PayrollAdjustment.create({
          payroll_entry_id,
          label: `Préstamo cuota USD ${amount_usd} (Cot: $${exchange_rate})`,
          amount: amount_ars,
          type: 'deduction',
          is_auto: true,
          created_by: req.user?.id,
          updated_by: req.user?.id
        }, { transaction });
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
      const newBalance = Number(loan.remaining_balance_usd) + Number(payment.amount_usd);
      
      await loan.update({
        remaining_balance_usd: newBalance,
        status: 'active' // Always revert to active if a payment is deleted
      }, { transaction });

      // If tied to a payroll entry, we should probably delete the related adjustment 
      // But it's complex to find exactly which one if label changed.
      // Usually, if tied to payroll, the system generated a PayrollAdjustment. 
      // Let's try to delete it based on amount and payroll_entry_id and is_auto
      if (payment.payroll_entry_id) {
        await PayrollAdjustment.destroy({
          where: {
            payroll_entry_id: payment.payroll_entry_id,
            amount: payment.amount_ars,
            type: 'deduction',
            is_auto: true
          },
          transaction
        });
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
