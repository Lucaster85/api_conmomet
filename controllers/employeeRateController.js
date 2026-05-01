const db = require("../models");

module.exports = {
  /**
   * Get all rates for a specific employee.
   */
  getByEmployee: async (req, res) => {
    try {
      const rates = await db.EmployeeRate.findAll({
        where: { employee_id: req.params.employeeId },
        include: [{ model: db.PayrollConcept, as: "concept", attributes: ["id", "name", "code", "calc_type"] }],
        order: [["id", "ASC"]],
      });
      return res.status(200).json({ count: rates.length, data: rates });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  /**
   * Create or update a rate for an employee.
   * If a rate for the same employee+concept exists, update it.
   */
  upsert: async (req, res) => {
    try {
      const { employee_id, concept_id, rate, guild_rate, snr_amount, extras_rate } = req.body;
      if (!employee_id || rate === undefined) {
        return res.status(400).json({ error: "employee_id y rate son obligatorios." });
      }

      // Check employee exists
      const employee = await db.Employee.findByPk(employee_id);
      if (!employee) return res.status(404).json({ error: "Empleado no encontrado." });

      // Find existing rate for same employee+concept
      const where = { employee_id };
      if (concept_id) {
        where.concept_id = concept_id;
      } else {
        where.concept_id = null;
      }

      let employeeRate = await db.EmployeeRate.findOne({ where });

      if (employeeRate) {
        await employeeRate.update({ rate, guild_rate, snr_amount, extras_rate });
      } else {
        employeeRate = await db.EmployeeRate.create({
          employee_id, concept_id: concept_id || null, rate, guild_rate, snr_amount, extras_rate,
        });
      }

      // Reload with concept
      employeeRate = await db.EmployeeRate.findByPk(employeeRate.id, {
        include: [{ model: db.PayrollConcept, as: "concept", attributes: ["id", "name", "code", "calc_type"] }],
      });

      return res.status(200).json({ data: employeeRate });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  },

  /**
   * Bulk save rates for an employee (replace all rates).
   */
  bulkSave: async (req, res) => {
    try {
      const { employee_id, rates } = req.body;
      if (!employee_id || !Array.isArray(rates)) {
        return res.status(400).json({ error: "employee_id y rates (array) son obligatorios." });
      }

      const employee = await db.Employee.findByPk(employee_id);
      if (!employee) return res.status(404).json({ error: "Empleado no encontrado." });

      // Delete existing rates
      await db.EmployeeRate.destroy({ where: { employee_id } });

      // Create new rates
      const created = [];
      for (const r of rates) {
        const record = await db.EmployeeRate.create({
          employee_id,
          concept_id: r.concept_id || null,
          rate: r.rate,
          guild_rate: r.guild_rate || null,
          snr_amount: r.snr_amount || null,
          extras_rate: r.extras_rate || null,
        });
        created.push(record);
      }

      // Reload with concepts
      const result = await db.EmployeeRate.findAll({
        where: { employee_id },
        include: [{ model: db.PayrollConcept, as: "concept", attributes: ["id", "name", "code", "calc_type"] }],
        order: [["id", "ASC"]],
      });

      return res.status(200).json({ count: result.length, data: result });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  },

  /**
   * Delete a specific rate.
   */
  destroy: async (req, res) => {
    try {
      const rate = await db.EmployeeRate.findByPk(req.params.id);
      if (!rate) return res.status(404).json({ error: "Tarifa no encontrada." });
      await rate.destroy();
      return res.status(200).json({ message: "Tarifa eliminada." });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
