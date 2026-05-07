const { PayrollAdjustment, PayrollEntry } = require('../models');

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
      const { payroll_entry_id, label, amount, type } = req.body;

      if (!payroll_entry_id || !label || amount === undefined || !type) {
        return res.status(400).json({ message: 'Missing required fields' });
      }

      const entry = await PayrollEntry.findByPk(payroll_entry_id);
      if (!entry) {
        return res.status(404).json({ message: 'Payroll entry not found' });
      }

      const adjustment = await PayrollAdjustment.create({
        payroll_entry_id,
        label,
        amount,
        type,
        is_auto: false, // Manual by definition
        created_by: req.user?.id,
        updated_by: req.user?.id
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
      const { label, amount, type } = req.body;

      const adjustment = await PayrollAdjustment.findByPk(id);

      if (!adjustment) {
        return res.status(404).json({ message: 'Adjustment not found' });
      }
      
      if (adjustment.is_auto) {
        return res.status(400).json({ message: 'Cannot manually edit automatic adjustments' });
      }

      await adjustment.update({
        label: label || adjustment.label,
        amount: amount !== undefined ? amount : adjustment.amount,
        type: type || adjustment.type,
        updated_by: req.user?.id
      });

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

      await adjustment.destroy();
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting payroll adjustment:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }
};

module.exports = payrollAdjustmentController;
