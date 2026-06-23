const db = require('../models');
const { Guild } = db;
const { Op } = require('sequelize');

const guildController = {
  // GET /api/guilds
  getAll: async (req, res) => {
    try {
      const guilds = await Guild.findAll({
        order: [['name', 'ASC']]
      });
      res.status(200).json(guilds);
    } catch (error) {
      console.error('Error fetching guilds:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  },

  // GET /api/guilds/:id
  getById: async (req, res) => {
    try {
      const { id } = req.params;
      const guild = await Guild.findByPk(id);

      if (!guild) {
        return res.status(404).json({ message: 'Guild not found' });
      }

      res.status(200).json(guild);
    } catch (error) {
      console.error('Error fetching guild:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  },

  // POST /api/guilds
  create: async (req, res) => {
    try {
      const { name, code, is_active } = req.body;

      if (!name || !code) {
        return res.status(400).json({ message: 'Name and code are required' });
      }

      const guild = await Guild.create({
        name,
        code,
        is_active: is_active !== undefined ? is_active : true
      });

      res.status(201).json(guild);
    } catch (error) {
      console.error('Error creating guild:', error);
      if (error.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({ message: 'A guild with this code already exists' });
      }
      res.status(500).json({ message: 'Internal server error' });
    }
  },

  // PUT /api/guilds/:id
  update: async (req, res) => {
    try {
      const { id } = req.params;
      const { name, code, is_active } = req.body;

      const guild = await Guild.findByPk(id);

      if (!guild) {
        return res.status(404).json({ message: 'Guild not found' });
      }

      await guild.update({
        name: name || guild.name,
        code: code || guild.code,
        is_active: is_active !== undefined ? is_active : guild.is_active
      });

      res.status(200).json(guild);
    } catch (error) {
      console.error('Error updating guild:', error);
      if (error.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({ message: 'A guild with this code already exists' });
      }
      res.status(500).json({ message: 'Internal server error' });
    }
  },

  // DELETE /api/guilds/:id
  delete: async (req, res) => {
    try {
      const { id } = req.params;
      const guild = await Guild.findByPk(id);

      if (!guild) {
        return res.status(404).json({ message: 'Guild not found' });
      }

      await guild.destroy();
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting guild:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  },

  // POST /api/guilds/:id/apply-increase
  applyIncrease: async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
      const { id } = req.params;
      const { percentage, categoryIds, notes } = req.body;

      if (percentage === undefined || percentage === null || !Array.isArray(categoryIds) || categoryIds.length === 0) {
        return res.status(400).json({ message: 'El porcentaje y las categorías son obligatorios' });
      }

      const parsedPercentage = parseFloat(percentage);
      if (isNaN(parsedPercentage)) {
        return res.status(400).json({ message: 'El porcentaje debe ser un número válido' });
      }

      const guild = await Guild.findByPk(id, { transaction: t });
      if (!guild) {
        return res.status(404).json({ message: 'Gremio no encontrado' });
      }

      const multiplier = 1 + parsedPercentage / 100;
      const roundCCT = (val) => Math.round(val * 100) / 100; // 2 decimales
      const roundHR = (val) => Math.round(val);               // entero

      const summary = { categories: [], employees: [] };

      // 1. Update Categories
      const categories = await db.Category.findAll({
        where: {
          id: { [Op.in]: categoryIds },
          guild_id: id
        },
        transaction: t
      });

      for (const cat of categories) {
        const oldRate = parseFloat(cat.guild_hourly_rate || 0);
        const newRate = roundCCT(oldRate * multiplier);
        await cat.update({ guild_hourly_rate: newRate }, { transaction: t });
        summary.categories.push({
          id: cat.id,
          name: cat.name,
          oldRate,
          newRate
        });
      }

      // 2. Find employees affected (hourly only)
      const employees = await db.Employee.findAll({
        where: {
          category_id: { [Op.in]: categoryIds },
          pay_type: 'hourly',
          status: { [Op.in]: ['active', 'vacation', 'medical_leave'] }
        },
        include: [{
          model: db.EmployeeRate,
          as: 'employeeRates',
          where: { concept_id: { [Op.ne]: null } },
          required: false
        }],
        transaction: t
      });

      // 3. Update each employee
      for (const emp of employees) {
        const oldHourly = parseFloat(emp.hourly_rate || 0);
        const newHourly = roundHR(oldHourly * multiplier);
        
        await emp.update({ hourly_rate: newHourly }, { transaction: t });

        // Record Salary History
        await db.SalaryHistory.create({
          employee_id: emp.id,
          field_changed: 'hourly_rate',
          previous_value: oldHourly,
          new_value: newHourly,
          effective_date: new Date().toISOString().split('T')[0], // DATEONLY
          changed_by: req.user?.id || null,
          notes: notes || `Aumento inmediato del ${percentage}% - Gremio ${guild.name}`
        }, { transaction: t });

        const empSummary = {
          id: emp.id,
          name: `${emp.lastname || ''} ${emp.name || ''}`.trim(),
          oldHourly,
          newHourly,
          rates: []
        };

        // 4. Update employee rates (special rates)
        if (emp.employeeRates && emp.employeeRates.length > 0) {
          for (const rate of emp.employeeRates) {
            const oldRate = parseFloat(rate.rate || 0);
            const newRate = roundHR(oldRate * multiplier);
            const updateData = { rate: newRate };

            let oldGuildRate = null;
            let newGuildRate = null;

            if (rate.guild_rate !== null && rate.guild_rate !== undefined) {
              oldGuildRate = parseFloat(rate.guild_rate || 0);
              newGuildRate = roundHR(oldGuildRate * multiplier);
              updateData.guild_rate = newGuildRate;
            }

            await rate.update(updateData, { transaction: t });

            empSummary.rates.push({
              id: rate.id,
              concept_id: rate.concept_id,
              oldRate,
              newRate,
              oldGuildRate,
              newGuildRate
            });
          }
        }

        summary.employees.push(empSummary);
      }

      await t.commit();
      res.status(200).json({ message: 'Aumento aplicado con éxito', summary });
    } catch (error) {
      await t.rollback();
      console.error('Error applying increase:', error);
      res.status(500).json({ message: 'Error interno del servidor al aplicar aumento', error: error.message });
    }
  }
};

module.exports = guildController;
