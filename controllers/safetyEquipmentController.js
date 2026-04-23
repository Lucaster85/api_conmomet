const db = require("../models");

module.exports = {
  getAll: async (req, res) => {
    try {
      const { employee_id } = req.query;
      const where = {};
      if (employee_id) where.employee_id = employee_id;

      const { count, rows } = await db.SafetyEquipment.findAndCountAll({
        where,
        include: [
          { model: db.Employee, as: "employee", attributes: ["id", "name", "lastname"] },
          { model: db.User, as: "deliveredBy", attributes: ["id", "name", "lastname"] },
        ],
        order: [["delivered_date", "DESC"]],
      });
      return res.status(200).json({ count, data: rows });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    const { employee_id, item_name, delivered_date, condition, notes } = req.body;

    if (!employee_id || !item_name || !delivered_date) {
      return res.status(400).json({ error: "Empleado, artículo y fecha de entrega son obligatorios." });
    }

    try {
      const employee = await db.Employee.findByPk(employee_id);
      if (!employee) return res.status(404).json({ error: "Empleado no encontrado." });

      const item = await db.SafetyEquipment.create({
        employee_id, item_name, delivered_date, condition, notes,
        delivered_by: req.user.id,
      });

      return res.status(201).json({ data: item });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  update: async (req, res) => {
    try {
      const item = await db.SafetyEquipment.findByPk(req.params.id);
      if (!item) return res.status(404).json({ error: "Registro no encontrado." });

      const { item_name, delivered_date, return_date, condition, notes } = req.body;
      await item.update({ item_name, delivered_date, return_date, condition, notes });

      return res.status(200).json({ data: item });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
