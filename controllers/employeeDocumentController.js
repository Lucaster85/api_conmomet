const db = require("../models");
const { uploadToR2, deleteFromR2 } = require("../helpers");

module.exports = {
  getAll: async (req, res) => {
    const { id } = req.params; // employee_id
    try {
      const employee = await db.Employee.findByPk(id);
      if (!employee) return res.status(404).json({ error: "Empleado no encontrado." });

      const documents = await db.EmployeeDocument.findAll({
        where: { employee_id: id },
        include: [{ model: db.User, as: "uploader", attributes: ["id", "name", "lastname"] }],
        order: [["created_at", "DESC"]],
      });
      return res.status(200).json({ count: documents.length, data: documents });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  upload: async (req, res) => {
    const { id } = req.params; // employee_id
    const { title } = req.body;
    const file = req.file;

    if (!file) return res.status(400).json({ error: "No se adjuntó ningún archivo." });
    if (!title) return res.status(400).json({ error: "El título es obligatorio." });

    try {
      const employee = await db.Employee.findByPk(id);
      if (!employee) return res.status(404).json({ error: "Empleado no encontrado." });

      const folder = `employees/${id}/documents`;
      const file_url = await uploadToR2(file, folder);
      const file_key = file_url.replace(`${process.env.STORAGE_PUBLIC_URL}/`, "");

      const document = await db.EmployeeDocument.create({
        employee_id: id,
        title,
        file_url,
        file_key,
        file_name: file.originalname,
        file_type: file.mimetype,
        uploaded_by: req.user.id,
      });

      return res.status(201).json({ data: document });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  destroy: async (req, res) => {
    const { id, docId } = req.params;
    try {
      const document = await db.EmployeeDocument.findOne({
        where: { id: docId, employee_id: id },
      });
      if (!document) return res.status(404).json({ error: "Documento no encontrado." });

      await deleteFromR2(document.file_url);
      await document.destroy();

      return res.status(200).json({ message: "Documento eliminado correctamente." });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
