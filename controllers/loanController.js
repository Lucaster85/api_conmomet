const { Loan, LoanPayment, LoanInterestApplication, LoanInstallment, Employee, User, PayrollEntry, PayPeriod } = require('../models');
const sequelize = require('../config/sequelize');
const { Op } = require('sequelize');
const { recordAudit } = require('../services/auditLogService');
const { uploadToR2 } = require('../helpers');
const { round2, buildInstallmentRecords } = require('../services/loanAmortizationService');
const { getMaxLoanAmount } = require('../helpers/systemSettings');
const { findActiveLoan } = require('../helpers/loanValidations');

// Genera y persiste el plan de cuotas de un préstamo `fixed_installments` — se llama una sola
// vez, cuando el préstamo queda con sus términos definitivos (alta directa o aprobación de un
// pedido self-service). Ver services/loanAmortizationService.js para la fórmula.
const generateAndSaveSchedule = async (loan, { transaction }) => {
  const { installmentAmount, duePeriodType, records } = buildInstallmentRecords({
    loanId: loan.id,
    startDate: loan.start_date,
    amount: loan.amount,
    monthlyInterestPercent: loan.monthly_interest_percent,
    numInstallments: loan.num_installments,
  });
  await LoanInstallment.bulkCreate(records, { transaction });
  await loan.update({ installment_amount: installmentAmount, due_period_type: duePeriodType }, { transaction });
};

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
            attributes: ['id', 'name', 'lastname', 'phone']
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
          { model: Employee, as: 'employee', attributes: ['id', 'name', 'lastname', 'phone'] },
          {
            model: LoanInstallment,
            as: 'installments',
            separate: true,
            order: [['installment_number', 'ASC']],
          },
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
  // Todo préstamo nuevo se crea SIEMPRE con cuota fija (plan_type forzado del lado del
  // servidor, nunca lee ese campo del body) y en ARS — el formato "a discreción" y el USD
  // quedan congelados solo para los préstamos que ya existían antes de este rediseño.
  create: async (req, res) => {
    const t = await sequelize.transaction();
    try {
      const { employee_id, amount, start_date, notes, payment_method, mark_as_paid, num_installments, monthly_interest_percent } = req.body;

      if (!employee_id || !amount || !start_date) {
        await t.rollback();
        return res.status(400).json({ message: 'Missing required fields' });
      }

      const numInstallments = Number(num_installments);
      if (!Number.isInteger(numInstallments) || numInstallments <= 0) {
        await t.rollback();
        return res.status(400).json({ message: 'La cantidad de cuotas es obligatoria y debe ser un entero mayor a cero.' });
      }
      const monthlyInterestPercent = monthly_interest_percent ? Number(monthly_interest_percent) : 0;

      const maxLoanAmount = await getMaxLoanAmount();
      if (Number(amount) > maxLoanAmount) {
        await t.rollback();
        return res.status(400).json({ message: `El monto supera el tope máximo de préstamo permitido ($${maxLoanAmount}).` });
      }

      const existingActiveLoan = await findActiveLoan(employee_id, { transaction: t });
      if (existingActiveLoan) {
        await t.rollback();
        return res.status(400).json({ message: 'El empleado ya tiene un préstamo activo — no puede tomar otro hasta saldarlo.' });
      }

      const isPaidNow = mark_as_paid === undefined ? true : (mark_as_paid === true || mark_as_paid === 'true');

      if (isPaidNow && payment_method === 'transferencia' && !req.file) {
        await t.rollback();
        return res.status(400).json({ message: 'El comprobante de pago es obligatorio para transferencias.' });
      }

      let paymentProofFields = { payment_proof_url: null, payment_proof_key: null, payment_proof_name: null };
      if (req.file) {
        paymentProofFields = await buildPaymentProof(req.file);
      }

      const loan = await Loan.create({
        employee_id,
        plan_type: 'fixed_installments',
        currency: 'ARS',
        amount,
        num_installments: numInstallments,
        monthly_interest_percent: monthlyInterestPercent,
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
      }, { transaction: t });

      await generateAndSaveSchedule(loan, { transaction: t });

      await recordAudit({
        entityType: 'Loan',
        entityId: loan.id,
        action: 'create',
        fieldChanged: 'amount',
        newValue: loan.amount,
        amount: loan.amount,
        context: { employee_id, currency: 'ARS', num_installments: numInstallments, monthly_interest_percent: monthlyInterestPercent },
        userId: req.user?.id,
      }, t);

      await t.commit();
      res.status(201).json(loan);
    } catch (error) {
      await t.rollback();
      console.error('Error creating loan:', error);
      res.status(500).json({ message: error.message || 'Internal server error' });
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
  // El préstamo llega `pending` con `plan_type` ya forzado a `fixed_installments` desde
  // requestLoan (self-service) — acá se cierran los términos definitivos (monto, cuotas,
  // interés) y recién ahí se genera el plan de cuotas, una sola vez.
  approve: async (req, res) => {
    const t = await sequelize.transaction();
    try {
      const { id } = req.params;
      const { amount, payment_method, notes, start_date, mark_as_paid, num_installments, monthly_interest_percent } = req.body;

      const loan = await Loan.findByPk(id, { transaction: t });
      if (!loan) {
        await t.rollback();
        return res.status(404).json({ message: 'Loan not found' });
      }
      if (loan.status !== 'pending') {
        await t.rollback();
        return res.status(400).json({ message: `No se puede aprobar un préstamo en estado: ${loan.status}` });
      }

      const finalAmount = amount !== undefined && amount !== null && amount !== '' ? amount : loan.amount;

      const numInstallments = Number(
        num_installments !== undefined && num_installments !== null && num_installments !== ''
          ? num_installments
          : loan.requested_num_installments
      );
      if (!Number.isInteger(numInstallments) || numInstallments <= 0) {
        await t.rollback();
        return res.status(400).json({ message: 'La cantidad de cuotas es obligatoria y debe ser un entero mayor a cero.' });
      }
      const monthlyInterestPercent = monthly_interest_percent !== undefined && monthly_interest_percent !== null && monthly_interest_percent !== ''
        ? Number(monthly_interest_percent)
        : 0;

      const maxLoanAmount = await getMaxLoanAmount();
      if (Number(finalAmount) > maxLoanAmount) {
        await t.rollback();
        return res.status(400).json({ message: `El monto supera el tope máximo de préstamo permitido ($${maxLoanAmount}).` });
      }

      // El propio préstamo sigue "pending" acá, así que no se matchea a sí mismo — esto solo
      // atrapa el caso de que se le haya aprobado/activado otro préstamo al empleado mientras
      // este pedido esperaba aprobación.
      const existingActiveLoan = await findActiveLoan(loan.employee_id, { transaction: t });
      if (existingActiveLoan) {
        await t.rollback();
        return res.status(400).json({ message: 'El empleado ya tiene un préstamo activo — no se puede aprobar otro hasta que lo salde.' });
      }

      const isPaidNow = mark_as_paid === true || mark_as_paid === 'true';
      const finalPaymentMethod = payment_method || loan.payment_method;

      if (isPaidNow && finalPaymentMethod === 'transferencia' && !req.file) {
        await t.rollback();
        return res.status(400).json({ message: 'El comprobante de pago es obligatorio para transferencias.' });
      }

      const updateData = {
        amount: finalAmount,
        remaining_balance: finalAmount,
        currency: 'ARS',
        plan_type: 'fixed_installments',
        num_installments: numInstallments,
        monthly_interest_percent: monthlyInterestPercent,
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

      await loan.update(updateData, { transaction: t });
      await generateAndSaveSchedule(loan, { transaction: t });

      await recordAudit({
        entityType: 'Loan',
        entityId: loan.id,
        action: 'update',
        fieldChanged: 'status',
        previousValue: 'pending',
        newValue: loan.status,
        amount: loan.amount,
        context: { employee_id: loan.employee_id, paid: isPaidNow, num_installments: numInstallments, monthly_interest_percent: monthlyInterestPercent },
        userId: req.user?.id,
      }, t);

      await t.commit();
      res.status(200).json(loan);
    } catch (error) {
      await t.rollback();
      console.error('Error approving loan:', error);
      res.status(500).json({ message: error.message || 'Internal server error' });
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
        rejection_reason: req.body.notes || null,
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
  },

  // POST /api/loans/:id/settle
  // Liquidación del préstamo por baja del empleado (renuncia o despido) — NO es cancelación
  // anticipada por elección del empleado, esa no existe. La cuota que está corriendo en la
  // quincena actual (o que por algún motivo quedó vencida sin descontarse — no debería pasar en
  // el flujo normal, el descuento automático ya se encarga) se cobra COMPLETA; todas las cuotas
  // restantes, que todavía no llegaron a su quincena, se liquidan cobrando solo el capital — el
  // interés de esas se perdona. Deliberadamente independiente de cualquier flujo de "baja de
  // empleado" (que no existe todavía) — cuando se construya ese proceso más adelante, debe llamar
  // a este mismo endpoint en vez de reimplementar esta lógica.
  settle: async (req, res) => {
    const t = await sequelize.transaction();
    try {
      const { id } = req.params;
      const { reason, notes } = req.body;

      const loan = await Loan.findByPk(id, { transaction: t });
      if (!loan) {
        await t.rollback();
        return res.status(404).json({ message: 'Loan not found' });
      }
      if (loan.plan_type !== 'fixed_installments') {
        await t.rollback();
        return res.status(400).json({ message: 'La liquidación por baja solo aplica a préstamos de cuota fija.' });
      }
      if (loan.status !== 'active') {
        await t.rollback();
        return res.status(400).json({ message: 'Solo se puede liquidar un préstamo activo.' });
      }

      const scheduled = await LoanInstallment.findAll({
        where: { loan_id: loan.id, status: 'scheduled' },
        order: [['installment_number', 'ASC']],
        transaction: t,
      });

      if (scheduled.length === 0) {
        await t.rollback();
        return res.status(400).json({ message: 'El préstamo no tiene cuotas pendientes para liquidar.' });
      }

      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];
      const currentYear = today.getFullYear();
      const currentMonth = today.getMonth() + 1;

      let totalCharged = 0;

      for (const inst of scheduled) {
        // La cuota de la quincena que está corriendo (o vencida) se cobra completa; las de meses
        // que todavía no llegaron se liquidan solo a capital.
        const isCurrentOrPast = (inst.due_year < currentYear)
          || (inst.due_year === currentYear && inst.due_month <= currentMonth);
        const amountToCharge = isCurrentOrPast ? Number(inst.total_amount) : Number(inst.principal_amount);
        totalCharged += amountToCharge;

        const payment = await LoanPayment.create({
          loan_id: loan.id,
          loan_installment_id: inst.id,
          amount: amountToCharge,
          date: todayStr,
          notes: notes || `Liquidación por baja — cuota ${inst.installment_number}/${loan.num_installments}${isCurrentOrPast ? '' : ' (sin interés)'}`,
          created_by: req.user?.id,
          updated_by: req.user?.id,
        }, { transaction: t });

        await inst.update({
          status: 'prepaid',
          deducted_at: todayStr,
          loan_payment_id: payment.id,
        }, { transaction: t });
      }

      totalCharged = round2(totalCharged);

      await loan.update({
        remaining_balance: 0,
        status: 'completed',
        updated_by: req.user?.id,
      }, { transaction: t });

      await recordAudit({
        entityType: 'Loan',
        entityId: loan.id,
        action: 'update',
        fieldChanged: 'remaining_balance',
        previousValue: loan.remaining_balance,
        newValue: 0,
        amount: totalCharged,
        context: { employee_id: loan.employee_id, reason: reason || 'other', trigger: 'settle' },
        userId: req.user?.id,
      }, t);

      await t.commit();
      res.status(200).json({ loan, total_charged: totalCharged });
    } catch (error) {
      await t.rollback();
      console.error('Error settling loan:', error);
      res.status(500).json({ message: error.message || 'Internal server error' });
    }
  },
};

module.exports = loanController;
