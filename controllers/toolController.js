const { Op } = require("sequelize");
const db = require("../models");
const { validateRepairResponsible } = require("../helpers/toolRepair");

const STATUS_VALUES = ["available", "reserved", "delivered", "in_repair", "retired", "lost"];

module.exports = {
  getAll: async (req, res) => {
    try {
      const { tool_type_id, status, q } = req.query;
      const where = {};
      if (tool_type_id) where.tool_type_id = tool_type_id;
      if (status) where.status = status;
      if (q) {
        where[Op.or] = [
          { name: { [Op.like]: `%${q}%` } },
          { reference_code: { [Op.like]: `%${q}%` } },
          { brand: { [Op.like]: `%${q}%` } },
          { model: { [Op.like]: `%${q}%` } },
          { serial_number: { [Op.like]: `%${q}%` } },
        ];
      }

      const items = await db.Tool.findAll({
        where,
        include: [
          { model: db.ToolType, as: "toolType" },
          { model: db.Employee, as: "repairResponsible", attributes: ["id", "name", "lastname"] },
        ],
        order: [["name", "ASC"]],
      });
      return res.status(200).json({ data: items });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  get: async (req, res) => {
    try {
      const tool = await db.Tool.findByPk(req.params.id, {
        include: [
          { model: db.ToolType, as: "toolType" },
          { model: db.Employee, as: "repairResponsible", attributes: ["id", "name", "lastname"] },
        ],
      });
      if (!tool) return res.status(404).json({ error: "Herramienta no encontrada." });
      return res.status(200).json({ data: tool });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    try {
      const { tool_type_id, name, reference_code, brand, model, serial_number, notes } = req.body;
      if (!tool_type_id || !name || !reference_code) {
        return res.status(400).json({ error: "Tipo, nombre y código de referencia son obligatorios." });
      }

      const existing = await db.Tool.findOne({ where: { reference_code } });
      if (existing) {
        return res.status(400).json({ error: "Ya existe una herramienta con ese código de referencia." });
      }

      const tool = await db.Tool.create({
        tool_type_id,
        name,
        reference_code,
        brand: brand || null,
        model: model || null,
        serial_number: serial_number || null,
        notes: notes || null,
        status: "available",
      });

      const created = await db.Tool.findByPk(tool.id, { include: [{ model: db.ToolType, as: "toolType" }] });
      return res.status(201).json({ data: created });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // reference_code nunca se acepta acá — mismo criterio de inmutabilidad-por-omisión que
  // Oca.number (sin trigger de DB, solo el controller no lo deja pasar).
  update: async (req, res) => {
    try {
      const tool = await db.Tool.findByPk(req.params.id);
      if (!tool) return res.status(404).json({ error: "Herramienta no encontrada." });

      const { tool_type_id, name, brand, model, serial_number, notes } = req.body;
      await tool.update({
        tool_type_id: tool_type_id !== undefined ? tool_type_id : tool.tool_type_id,
        name: name !== undefined ? name : tool.name,
        brand: brand !== undefined ? brand : tool.brand,
        model: model !== undefined ? model : tool.model,
        serial_number: serial_number !== undefined ? serial_number : tool.serial_number,
        notes: notes !== undefined ? notes : tool.notes,
      });

      const updated = await db.Tool.findByPk(tool.id, { include: [{ model: db.ToolType, as: "toolType" }] });
      return res.status(200).json({ data: updated });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  changeStatus: async (req, res) => {
    try {
      const tool = await db.Tool.findByPk(req.params.id);
      if (!tool) return res.status(404).json({ error: "Herramienta no encontrada." });

      const { status, notes, responsible_employee_id } = req.body;
      if (!status || !STATUS_VALUES.includes(status)) {
        return res.status(400).json({ error: "Estado inválido." });
      }
      if (tool.status === "delivered" || status === "delivered") {
        return res.status(400).json({ error: "Para entregar o recibir la herramienta usá el flujo de asignaciones, no el cambio de estado directo." });
      }

      if (status === "in_repair") {
        const responsibleError = await validateRepairResponsible(responsible_employee_id);
        if (responsibleError) return res.status(400).json({ error: responsibleError });
      }

      await db.ToolStatusLog.create({
        tool_id: tool.id,
        from_status: tool.status,
        to_status: status,
        changed_by: req.user.id,
        notes: notes || null,
        responsible_employee_id: status === "in_repair" ? responsible_employee_id : null,
      });
      await tool.update({
        status,
        repair_responsible_id: status === "in_repair" ? responsible_employee_id : null,
      });

      return res.status(200).json({ data: tool });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  getStatusHistory: async (req, res) => {
    try {
      const tool = await db.Tool.findByPk(req.params.id);
      if (!tool) return res.status(404).json({ error: "Herramienta no encontrada." });

      const history = await db.ToolStatusLog.findAll({
        where: { tool_id: tool.id },
        include: [
          { model: db.User, as: "changedByUser", attributes: ["id", "name", "lastname"] },
          { model: db.Employee, as: "responsibleEmployee", attributes: ["id", "name", "lastname"] },
        ],
        order: [["changed_at", "DESC"]],
      });
      return res.status(200).json({ data: history });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  destroy: async (req, res) => {
    try {
      const tool = await db.Tool.findByPk(req.params.id);
      if (!tool) return res.status(404).json({ error: "Herramienta no encontrada." });

      const usageCount = await db.AssetAssignment.count({ where: { tool_id: tool.id } });
      if (usageCount > 0) {
        return res.status(400).json({ error: `No se puede eliminar: tiene ${usageCount} asignación(es) registrada(s). Marcá "De baja" en su lugar.` });
      }

      await tool.destroy();
      return res.status(200).json({ message: "Herramienta eliminada." });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
