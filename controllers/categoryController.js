const db = require("../models");
const { recalculateEntry } = require("./payrollAdjustmentController");

module.exports = {
  getAll: async (req, res) => {
    try {
      const { guild_id } = req.query;
      const where = {};
      if (guild_id) {
        where.guild_id = guild_id;
      }
      const { count, rows } = await db.Category.findAndCountAll({
        where,
        include: [{ model: db.Guild, as: "guild" }],
        order: [["name", "ASC"]],
      });
      return res.status(200).json({ count, data: rows });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  get: async (req, res) => {
    try {
      const item = await db.Category.findByPk(req.params.id, {
        include: [{ model: db.Guild, as: "guild" }],
      });
      if (!item) return res.status(400).json({ error: "Categoría no encontrada." });
      return res.status(200).json({ data: item });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    try {
      const { name, guild_hourly_rate, guild_id } = req.body;
      if (!name || guild_hourly_rate === undefined || !guild_id) {
        return res.status(400).json({ error: "Nombre, valor hora y gremio son obligatorios." });
      }
      const item = await db.Category.create({ name, guild_hourly_rate, guild_id });
      return res.status(201).json({ data: item });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  update: async (req, res) => {
    try {
      const item = await db.Category.findByPk(req.params.id);
      if (!item) return res.status(400).json({ error: "Categoría no encontrada." });
      const { name, guild_hourly_rate, guild_id } = req.body;
      await item.update({ name, guild_hourly_rate, guild_id });
      return res.status(200).json({ data: item });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  destroy: async (req, res) => {
    try {
      const item = await db.Category.findByPk(req.params.id);
      if (!item) return res.status(400).json({ error: "Categoría no encontrada." });
      await item.destroy();
      return res.status(200).json({ message: "Categoría eliminada correctamente." });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // POST /categories/:id/apply-bonus
  applyBonus: async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
      const { id } = req.params;
      const { pay_period_id, amount, label } = req.body;

      if (!pay_period_id || amount === undefined || amount === null || !label) {
        await t.rollback();
        return res.status(400).json({ error: "La quincena, el monto y la descripción son obligatorios." });
      }
      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        await t.rollback();
        return res.status(400).json({ error: "El monto debe ser mayor a 0." });
      }

      const category = await db.Category.findByPk(id, { transaction: t });
      if (!category) {
        await t.rollback();
        return res.status(404).json({ error: "Categoría no encontrada." });
      }

      const payPeriod = await db.PayPeriod.findByPk(pay_period_id, { transaction: t });
      if (!payPeriod) {
        await t.rollback();
        return res.status(404).json({ error: "Quincena no encontrada." });
      }
      if (payPeriod.status !== "open") {
        await t.rollback();
        return res.status(400).json({ error: "Solo se puede aplicar la suma no remunerativa sobre una quincena abierta." });
      }

      // Por ahora solo empleados jornalizados; los mensualizados se cargan manualmente.
      const employees = await db.Employee.findAll({
        where: { category_id: id, status: "active", pay_type: "hourly" },
        transaction: t,
      });

      const created = [];
      const skipped = [];

      for (const emp of employees) {
        const entry = await db.PayrollEntry.findOne({
          where: { employee_id: emp.id, pay_period_id },
          transaction: t,
        });

        if (!entry) {
          skipped.push({
            employee_id: emp.id,
            name: `${emp.lastname}, ${emp.name}`,
            reason: "La liquidación de esta quincena todavía no fue generada para este empleado.",
          });
          continue;
        }

        await db.PayrollAdjustment.create({
          payroll_entry_id: entry.id,
          label,
          amount: parsedAmount,
          type: "bonus",
          is_auto: false,
          created_by: req.user?.id,
          updated_by: req.user?.id,
        }, { transaction: t });

        await recalculateEntry(entry.id, t);

        created.push({ employee_id: emp.id, name: `${emp.lastname}, ${emp.name}` });
      }

      await t.commit();
      return res.status(200).json({
        message: `Suma no remunerativa aplicada a ${created.length} empleado(s).${skipped.length > 0 ? ` ${skipped.length} salteado(s).` : ''}`,
        created,
        skipped,
      });
    } catch (error) {
      await t.rollback();
      return res.status(500).json({ error: error.message });
    }
  },
};
