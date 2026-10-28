const db = require("../models");

module.exports = {
  getAll: async (req, res) => {
    try {
      const alerts = await db.LoanChangeAlert.findAll({
        include: [
          { model: db.Employee, as: "employee", attributes: ["id", "name", "lastname"] },
          { model: db.Loan, as: "loan", attributes: ["id", "status"] },
          { model: db.User, as: "createdBy", attributes: ["id", "name", "lastname"] },
        ],
        order: [["created_at", "DESC"]],
      });

      // `created_at` explícito: con `underscored: true` la columna es snake_case pero el
      // atributo del modelo es `createdAt` — ver salaryAdvanceDeletionAlertController.js.
      const data = alerts.map((a) => {
        const plain = a.toJSON();
        return { ...plain, created_at: plain.created_at || plain.createdAt };
      });

      return res.status(200).json({ data });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
