const { RateChange, Guild, PayrollConcept, PayPeriod, Employee, Category, PayrollEntry, PayrollLine } = require('../models');
const { Op } = require('sequelize');

const rateChangeController = {
  // GET /api/rate-changes
  getAll: async (req, res) => {
    try {
      const { status, guild_id } = req.query;
      const whereClause = {};
      
      if (status) whereClause.status = status;
      if (guild_id) whereClause.guild_id = guild_id;

      const rateChanges = await RateChange.findAll({
        where: whereClause,
        include: [
          { model: Guild, as: 'guild', attributes: ['id', 'name'] },
          { model: PayrollConcept, as: 'concept', attributes: ['id', 'name'] },
          { model: PayPeriod, as: 'appliesFromPeriod' },
          { model: PayPeriod, as: 'appliedInPeriod' }
        ],
        order: [['createdAt', 'DESC']]
      });
      res.status(200).json(rateChanges);
    } catch (error) {
      console.error('Error fetching rate changes:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  },

  // POST /api/rate-changes
  create: async (req, res) => {
    try {
      const { guild_id, concept_id, percentage, applies_from_period, applied_in_period, notes } = req.body;

      if (!guild_id || !percentage || !applies_from_period || !applied_in_period) {
        return res.status(400).json({ message: 'Missing required fields' });
      }

      const rateChange = await RateChange.create({
        guild_id,
        concept_id: concept_id || null, // null means all concepts
        percentage,
        applies_from_period,
        applied_in_period,
        status: 'pending',
        notes,
        created_by: req.user?.id,
        updated_by: req.user?.id
      });

      res.status(201).json(rateChange);
    } catch (error) {
      console.error('Error creating rate change:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  },

  // DELETE /api/rate-changes/:id
  delete: async (req, res) => {
    try {
      const { id } = req.params;
      const rateChange = await RateChange.findByPk(id);

      if (!rateChange) {
        return res.status(404).json({ message: 'Rate change not found' });
      }

      if (rateChange.status === 'applied') {
        return res.status(400).json({ message: 'Cannot delete an already applied rate change' });
      }

      await rateChange.destroy();
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting rate change:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  },

  // POST /api/rate-changes/:id/preview
  preview: async (req, res) => {
    try {
      const { id } = req.params;
      const rateChange = await RateChange.findByPk(id, {
        include: [
          { model: PayPeriod, as: 'appliesFromPeriod' },
          { model: PayPeriod, as: 'appliedInPeriod' }
        ]
      });

      if (!rateChange) {
        return res.status(404).json({ message: 'Rate change not found' });
      }

      // Logic to preview the retroactive differences
      // 1. Get employees in the guild
      const employeesInGuild = await Employee.findAll({
        include: [{
          model: Category,
          as: 'category',
          where: { guild_id: rateChange.guild_id },
          required: true
        }]
      });
      const employeeIds = employeesInGuild.map(e => e.id);

      // 2. Get past periods affected
      const periods = await PayPeriod.findAll({
        where: {
          start_date: {
            [Op.gte]: rateChange.appliesFromPeriod.start_date
          },
          end_date: {
            [Op.lt]: rateChange.appliedInPeriod.start_date
          }
        }
      });
      const periodIds = periods.map(p => p.id);

      // 3. Get Payroll Entries & Lines for these employees in these periods
      const entries = await PayrollEntry.findAll({
        where: {
          employee_id: { [Op.in]: employeeIds },
          pay_period_id: { [Op.in]: periodIds }
        },
        include: [{
          model: PayrollLine,
          as: 'lines',
          where: rateChange.concept_id ? { concept_id: rateChange.concept_id } : undefined,
          required: false
        }]
      });

      const previewData = [];
      const percentageDecimal = parseFloat(rateChange.percentage) / 100;

      for (const entry of entries) {
        if (!entry.lines || entry.lines.length === 0) continue;

        let entryDifference = 0;
        const lineDifferences = [];

        for (const line of entry.lines) {
          // Do not apply retroactives to holiday or vacation because they are CCT based
          if (line.line_type === 'holiday' || line.line_type === 'vacation' || line.line_type === 'retroactive' || line.line_type === 'fixed') {
            continue;
          }

          const diff = parseFloat(line.subtotal) * percentageDecimal;
          entryDifference += diff;

          lineDifferences.push({
            original_line_id: line.id,
            label: `Retro ${rateChange.percentage}% ${line.label}`,
            difference: diff
          });
        }

        if (entryDifference > 0) {
          previewData.push({
            employee_id: entry.employee_id,
            period_id: entry.pay_period_id,
            total_difference: entryDifference,
            lines: lineDifferences
          });
        }
      }

      res.status(200).json(previewData);
    } catch (error) {
      console.error('Error previewing rate change:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }
};

module.exports = rateChangeController;
