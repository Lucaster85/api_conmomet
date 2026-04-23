const db = require("../models");
const { uploadToR2, deleteFromR2 } = require("../helpers");

module.exports = {
  getAll: async (req, res) => {
    try {
      const { employee_id, date_from, date_to, status } = req.query;
      const where = {};

      if (employee_id) where.employee_id = employee_id;
      if (status) where.status = status;
      if (date_from || date_to) {
        const { Op } = require("sequelize");
        where.date = {};
        if (date_from) where.date[Op.gte] = date_from;
        if (date_to) where.date[Op.lte] = date_to;
      }

      const { count, rows } = await db.Attendance.findAndCountAll({
        where,
        include: [{ model: db.Employee, as: "employee", attributes: ["id", "name", "lastname"] }],
        order: [["date", "DESC"]],
      });
      return res.status(200).json({ count, data: rows });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    const { employee_id, date, status, notes } = req.body;
    const file = req.file;

    if (!employee_id || !date || !status) {
      return res.status(400).json({ error: "Empleado, fecha y estado son obligatorios." });
    }

    try {
      const employee = await db.Employee.findByPk(employee_id);
      if (!employee) return res.status(404).json({ error: "Empleado no encontrado." });

      let document_url = null;
      let document_key = null;
      let document_name = null;

      if (file) {
        const folder = `employees/${employee_id}/attendance`;
        document_url = await uploadToR2(file, folder);
        document_key = document_url.replace(`${process.env.STORAGE_PUBLIC_URL}/`, "");
        document_name = file.originalname;
      }

      const attendance = await db.Attendance.create({
        employee_id, date, status, notes, document_url, document_key, document_name,
      });

      return res.status(201).json({ data: attendance });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  update: async (req, res) => {
    try {
      const attendance = await db.Attendance.findByPk(req.params.id);
      if (!attendance) return res.status(404).json({ error: "Registro no encontrado." });

      const { status, notes } = req.body;
      const file = req.file;

      let document_url = attendance.document_url;
      let document_key = attendance.document_key;
      let document_name = attendance.document_name;

      if (file) {
        // Delete old document if exists
        if (attendance.document_url) {
          await deleteFromR2(attendance.document_url);
        }
        const folder = `employees/${attendance.employee_id}/attendance`;
        document_url = await uploadToR2(file, folder);
        document_key = document_url.replace(`${process.env.STORAGE_PUBLIC_URL}/`, "");
        document_name = file.originalname;
      }

      await attendance.update({ status, notes, document_url, document_key, document_name });

      return res.status(200).json({ data: attendance });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
