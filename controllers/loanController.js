const { Loan, LoanPayment, Employee, User } = require('../models');

const loanController = {
  // GET /api/loans
  getAll: async (req, res) => {
    try {
      const { status, employee_id } = req.query;
      const whereClause = {};
      
      if (status) whereClause.status = status;
      if (employee_id) whereClause.employee_id = employee_id;

      const loans = await Loan.findAll({
        where: whereClause,
        include: [
          {
            model: Employee,
            as: 'employee',
            attributes: ['id', 'name', 'lastname']
          },
          {
            model: User,
            as: 'approvedBy',
            attributes: ['id', 'name', 'lastname']
          }
        ],
        order: [['start_date', 'DESC']]
      });
      res.status(200).json(loans);
    } catch (error) {
      console.error('Error fetching loans:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  },

  // GET /api/loans/:id
  getById: async (req, res) => {
    try {
      const { id } = req.params;
      const loan = await Loan.findByPk(id, {
        include: [
          { model: Employee, as: 'employee', attributes: ['id', 'name', 'lastname'] },
          { model: LoanPayment, as: 'payments', order: [['date', 'DESC']] }
        ]
      });

      if (!loan) {
        return res.status(404).json({ message: 'Loan not found' });
      }

      res.status(200).json(loan);
    } catch (error) {
      console.error('Error fetching loan:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  },

  // POST /api/loans
  create: async (req, res) => {
    try {
      const { employee_id, amount_usd, exchange_rate_at_origin, start_date, notes } = req.body;

      if (!employee_id || !amount_usd || !exchange_rate_at_origin || !start_date) {
        return res.status(400).json({ message: 'Missing required fields' });
      }

      const amount_ars_at_origin = amount_usd * exchange_rate_at_origin;

      const loan = await Loan.create({
        employee_id,
        amount_usd,
        exchange_rate_at_origin,
        amount_ars_at_origin,
        remaining_balance_usd: amount_usd,
        start_date,
        status: 'active',
        notes,
        approved_by: req.user?.id,
        created_by: req.user?.id,
        updated_by: req.user?.id
      });

      res.status(201).json(loan);
    } catch (error) {
      console.error('Error creating loan:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  },

  // PUT /api/loans/:id
  update: async (req, res) => {
    try {
      const { id } = req.params;
      const { notes, status } = req.body;

      const loan = await Loan.findByPk(id);

      if (!loan) {
        return res.status(404).json({ message: 'Loan not found' });
      }

      await loan.update({
        notes: notes !== undefined ? notes : loan.notes,
        status: status || loan.status,
        updated_by: req.user?.id
      });

      res.status(200).json(loan);
    } catch (error) {
      console.error('Error updating loan:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  },

  // DELETE /api/loans/:id
  delete: async (req, res) => {
    try {
      const { id } = req.params;
      const loan = await Loan.findByPk(id, {
        include: [{ model: LoanPayment, as: 'payments' }]
      });

      if (!loan) {
        return res.status(404).json({ message: 'Loan not found' });
      }

      if (loan.payments && loan.payments.length > 0) {
        return res.status(400).json({ message: 'Cannot delete a loan that has payments registered' });
      }

      await loan.destroy();
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting loan:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }
};

module.exports = loanController;
