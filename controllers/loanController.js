const { Loan, LoanPayment, LoanInterestApplication, Employee, User, PayrollEntry, PayPeriod } = require('../models');
const { Op } = require('sequelize');
const { recordAudit } = require('../services/auditLogService');
const { uploadToR2 } = require('../helpers');

const buildPaymentProof = async (file) => {
  const url = await uploadToR2(file, 'payment-proofs/loans');
  return {
    payment_proof_url: url,
    payment_proof_key: url.replace(`${process.env.STORAGE_PUBLIC_URL}/`, ''),
    payment_proof_name: file.originalname,
  };
};

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

      const pendingEmployeeIds = [...new Set(loans.filter(l => l.status === 'pending').map(l => l.employee_id))];
      let activeEmployeeIds = new Set();
      if (pendingEmployeeIds.length > 0) {
        const activeLoans = await Loan.findAll({
          where: { employee_id: { [Op.in]: pendingEmployeeIds }, status: { [Op.in]: ['approved', 'active'] } },
          attributes: ['employee_id'],
        });
        activeEmployeeIds = new Set(activeLoans.map(l => l.employee_id));
      }

      const result = loans.map((loan) => {
        const json = loan.toJSON();
        json.conflict_warning = (json.status === 'pending' && activeEmployeeIds.has(json.employee_id))
          ? 'El empleado ya tiene un préstamo activo o aprobado pendiente de pago'
          : null;
        return json;
      });

      res.status(200).json(result);
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
          {
            model: LoanPayment,
            as: 'payments',
            separate: true,
            order: [['date', 'DESC']],
            include: [
              {
                model: PayrollEntry,
                as: 'payrollEntry',
                attributes: ['id', 'pay_period_id'],
                include: [{ model: PayPeriod, as: 'payPeriod', attributes: ['id', 'start_date', 'end_date', 'type', 'month', 'year', 'status'] }]
              }
            ]
          },
          {
            model: LoanInterestApplication,
            as: 'interestApplications',
            separate: true,
            order: [['applied_at', 'DESC']],
            include: [{ model: User, as: 'appliedBy', attributes: ['id', 'name', 'lastname'] }]
          }
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
      const { employee_id, currency, amount, exchange_rate_at_origin, start_date, notes, payment_method, mark_as_paid } = req.body;

      if (!employee_id || !amount || !start_date) {
        return res.status(400).json({ message: 'Missing required fields' });
      }

      const loanCurrency = currency || 'USD';
      const isUSD = loanCurrency === 'USD';

      if (isUSD && !exchange_rate_at_origin) {
        return res.status(400).json({ message: 'Exchange rate is required for USD loans' });
      }

      const isPaidNow = mark_as_paid === undefined ? true : (mark_as_paid === true || mark_as_paid === 'true');

      if (isPaidNow && payment_method === 'transferencia' && !req.file) {
        return res.status(400).json({ message: 'El comprobante de pago es obligatorio para transferencias.' });
      }

      let paymentProofFields = { payment_proof_url: null, payment_proof_key: null, payment_proof_name: null };
      if (req.file) {
        paymentProofFields = await buildPaymentProof(req.file);
      }

      const loan = await Loan.create({
        employee_id,
        currency: loanCurrency,
        amount,
        exchange_rate_at_origin: isUSD ? exchange_rate_at_origin : null,
        amount_ars_at_origin: isUSD ? amount * exchange_rate_at_origin : null,
        remaining_balance: amount,
        payment_method,
        start_date,
        status: isPaidNow ? 'active' : 'approved',
        notes,
        approved_by: req.user?.id,
        approved_at: new Date(),
        paid_at: isPaidNow ? new Date() : null,
        paid_by: isPaidNow ? req.user?.id : null,
        ...paymentProofFields,
        created_by: req.user?.id,
        updated_by: req.user?.id
      });

      await recordAudit({
        entityType: 'Loan',
        entityId: loan.id,
        action: 'create',
        fieldChanged: 'amount',
        newValue: loan.amount,
        amount: loan.amount,
        context: { employee_id, currency: loanCurrency },
        userId: req.user?.id,
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

      const previousStatus = loan.status;

      await loan.update({
        notes: notes !== undefined ? notes : loan.notes,
        status: status || loan.status,
        updated_by: req.user?.id
      });

      if (status && status !== previousStatus) {
        await recordAudit({
          entityType: 'Loan',
          entityId: loan.id,
          action: 'update',
          fieldChanged: 'status',
          previousValue: previousStatus,
          newValue: loan.status,
          amount: loan.remaining_balance,
          context: { employee_id: loan.employee_id },
          userId: req.user?.id,
        });
      }

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

      if (loan.status !== 'pending') {
        return res.status(400).json({ message: 'Sólo se pueden eliminar préstamos pendientes de aprobación.' });
      }

      if (loan.payments && loan.payments.length > 0) {
        return res.status(400).json({ message: 'Cannot delete a loan that has payments registered' });
      }

      await recordAudit({
        entityType: 'Loan',
        entityId: loan.id,
        action: 'delete',
        fieldChanged: 'status',
        previousValue: loan.status,
        amount: loan.remaining_balance,
        context: { employee_id: loan.employee_id },
        userId: req.user?.id,
      });

      await loan.destroy();
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting loan:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  },

  // PUT /api/loans/:id/approve
  approve: async (req, res) => {
    try {
      const { id } = req.params;
      const { amount, currency, exchange_rate_at_origin, payment_method, notes, start_date, mark_as_paid } = req.body;

      const loan = await Loan.findByPk(id);
      if (!loan) return res.status(404).json({ message: 'Loan not found' });
      if (loan.status !== 'pending') {
        return res.status(400).json({ message: `No se puede aprobar un préstamo en estado: ${loan.status}` });
      }

      const finalAmount = amount !== undefined && amount !== null && amount !== '' ? amount : loan.amount;
      const finalCurrency = currency || loan.currency;
      const isUSD = finalCurrency === 'USD';

      if (isUSD && !exchange_rate_at_origin) {
        return res.status(400).json({ message: 'La cotización es obligatoria para préstamos en USD' });
      }

      const isPaidNow = mark_as_paid === true || mark_as_paid === 'true';
      const finalPaymentMethod = payment_method || loan.payment_method;

      if (isPaidNow && finalPaymentMethod === 'transferencia' && !req.file) {
        return res.status(400).json({ message: 'El comprobante de pago es obligatorio para transferencias.' });
      }

      const updateData = {
        amount: finalAmount,
        remaining_balance: finalAmount,
        currency: finalCurrency,
        exchange_rate_at_origin: isUSD ? exchange_rate_at_origin : null,
        amount_ars_at_origin: isUSD ? finalAmount * exchange_rate_at_origin : null,
        payment_method: finalPaymentMethod,
        notes: notes !== undefined ? notes : loan.notes,
        start_date: start_date || loan.start_date,
        status: isPaidNow ? 'active' : 'approved',
        approved_by: req.user?.id,
        approved_at: new Date(),
        paid_at: isPaidNow ? new Date() : null,
        paid_by: isPaidNow ? req.user?.id : null,
        updated_by: req.user?.id,
      };

      if (isPaidNow && req.file) {
        Object.assign(updateData, await buildPaymentProof(req.file));
      }

      await loan.update(updateData);

      await recordAudit({
        entityType: 'Loan',
        entityId: loan.id,
        action: 'update',
        fieldChanged: 'status',
        previousValue: 'pending',
        newValue: loan.status,
        amount: loan.amount,
        context: { employee_id: loan.employee_id, paid: isPaidNow },
        userId: req.user?.id,
      });

      res.status(200).json(loan);
    } catch (error) {
      console.error('Error approving loan:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  },

  // PUT /api/loans/:id/mark-paid
  markAsPaid: async (req, res) => {
    try {
      const { id } = req.params;
      const { payment_method } = req.body;

      if (!payment_method) {
        return res.status(400).json({ message: 'El método de pago es obligatorio' });
      }
      if (payment_method === 'transferencia' && !req.file) {
        return res.status(400).json({ message: 'El comprobante de pago es obligatorio para transferencias.' });
      }

      const loan = await Loan.findByPk(id);
      if (!loan) return res.status(404).json({ message: 'Loan not found' });
      if (loan.status !== 'approved') {
        return res.status(400).json({ message: `No se puede marcar como pagado un préstamo en estado: ${loan.status}` });
      }

      const updateData = {
        status: 'active',
        payment_method,
        paid_at: new Date(),
        paid_by: req.user?.id,
        updated_by: req.user?.id,
      };

      if (req.file) {
        Object.assign(updateData, await buildPaymentProof(req.file));
      }

      await loan.update(updateData);

      await recordAudit({
        entityType: 'Loan',
        entityId: loan.id,
        action: 'update',
        fieldChanged: 'status',
        previousValue: 'approved',
        newValue: 'active',
        amount: loan.amount,
        context: { employee_id: loan.employee_id, paid: true },
        userId: req.user?.id,
      });

      res.status(200).json(loan);
    } catch (error) {
      console.error('Error marking loan as paid:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  },

  // PUT /api/loans/:id/reject
  reject: async (req, res) => {
    try {
      const { id } = req.params;
      const loan = await Loan.findByPk(id);
      if (!loan) return res.status(404).json({ message: 'Loan not found' });
      if (loan.status !== 'pending') {
        return res.status(400).json({ message: `No se puede rechazar un préstamo en estado: ${loan.status}` });
      }

      await loan.update({
        status: 'rejected',
        notes: req.body.notes ? `${loan.notes || ''}\nRechazo: ${req.body.notes}` : loan.notes,
        updated_by: req.user?.id,
      });

      await recordAudit({
        entityType: 'Loan',
        entityId: loan.id,
        action: 'update',
        fieldChanged: 'status',
        previousValue: 'pending',
        newValue: 'rejected',
        context: { employee_id: loan.employee_id },
        userId: req.user?.id,
      });

      res.status(200).json(loan);
    } catch (error) {
      console.error('Error rejecting loan:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  },

  // POST /api/loans/:id/apply-interest
  applyInterest: async (req, res) => {
    const t = await Loan.sequelize.transaction();
    try {
      const { id } = req.params;
      const loan = await Loan.findByPk(id, { transaction: t });
      if (!loan) {
        await t.rollback();
        return res.status(404).json({ message: 'Loan not found' });
      }
      if (loan.status !== 'active') {
        await t.rollback();
        return res.status(400).json({ message: 'Sólo se puede aplicar interés a préstamos activos' });
      }

      const rate = req.body.rate_percent !== undefined && req.body.rate_percent !== null && req.body.rate_percent !== ''
        ? Number(req.body.rate_percent)
        : Number(loan.interest_rate_percent);

      if (!rate || rate <= 0) {
        await t.rollback();
        return res.status(400).json({ message: 'Debe indicarse una tasa de interés mayor a cero' });
      }

      const capitalBefore = Number(loan.remaining_balance);
      const interestAmount = Math.round((capitalBefore * (rate / 100)) * 100) / 100;
      const capitalAfter = Math.round((capitalBefore + interestAmount) * 100) / 100;

      await loan.update({
        remaining_balance: capitalAfter,
        updated_by: req.user?.id,
      }, { transaction: t });

      const application = await LoanInterestApplication.create({
        loan_id: loan.id,
        applied_by: req.user?.id,
        applied_at: new Date().toISOString().split('T')[0],
        rate_percent_used: rate,
        capital_before: capitalBefore,
        interest_amount: interestAmount,
        capital_after: capitalAfter,
        notes: req.body.notes,
      }, { transaction: t });

      await recordAudit({
        entityType: 'Loan',
        entityId: loan.id,
        action: 'update',
        fieldChanged: 'remaining_balance',
        previousValue: capitalBefore,
        newValue: capitalAfter,
        amount: interestAmount,
        context: { employee_id: loan.employee_id, rate_percent: rate },
        userId: req.user?.id,
      }, t);

      await t.commit();
      res.status(200).json({ loan, application });
    } catch (error) {
      await t.rollback();
      console.error('Error applying interest to loan:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }
};

module.exports = loanController;
