const db = require("../models");

module.exports = {
  getAll: async (req, res) => {
    try {
      const { client_id } = req.query;
      const where = {};
      
      if (client_id) {
        where.client_id = client_id;
      }

      const { count, rows } = await db.ClientSupervisor.findAndCountAll({
        where,
        order: [["lastname", "ASC"], ["name", "ASC"]],
      });
      return res.status(200).json({ count, data: rows });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  get: async (req, res) => {
    const { id } = req.params;
    try {
      const supervisor = await db.ClientSupervisor.findByPk(id);
      if (!supervisor) {
        return res.status(404).json({ error: "Supervisor no encontrado." });
      }
      return res.status(200).json({ data: supervisor });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    const { client_id, name, lastname, email, phone, is_active } = req.body;
    try {
      if (!client_id) {
        return res.status(400).json({ error: "El client_id es requerido." });
      }
      if (!name || !lastname) {
        return res.status(400).json({ error: "Nombre y Apellido son requeridos." });
      }

      const supervisor = await db.ClientSupervisor.create({
        client_id,
        name,
        lastname,
        email,
        phone,
        is_active: is_active !== undefined ? is_active : true,
      });

      return res.status(201).json({ supervisor });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  },

  update: async (req, res) => {
    const { id } = req.params;
    const { name, lastname, email, phone, is_active } = req.body;
    try {
      const supervisor = await db.ClientSupervisor.findByPk(id);
      if (!supervisor) {
        return res.status(404).json({ error: "Supervisor no encontrado." });
      }

      if (name !== undefined) supervisor.name = name;
      if (lastname !== undefined) supervisor.lastname = lastname;
      if (email !== undefined) supervisor.email = email;
      if (phone !== undefined) supervisor.phone = phone;
      if (is_active !== undefined) supervisor.is_active = is_active;

      await supervisor.save();
      return res.status(200).json(supervisor);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  destroy: async (req, res) => {
    const { id } = req.params;
    try {
      const supervisor = await db.ClientSupervisor.findByPk(id);
      if (!supervisor) {
        return res.status(404).json({ error: "Supervisor no encontrado." });
      }

      await supervisor.destroy();
      return res.status(200).json("Supervisor eliminado correctamente.");
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
