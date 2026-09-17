const db = require("../models");

module.exports = {
  getAll: async (req, res) => {
    try {
      const alerts = await db.SalaryAdvanceDeletionAlert.findAll({
        include: [
          { model: db.Employee, as: "employee", attributes: ["id", "name", "lastname"] },
          { model: db.PayPeriod, as: "payPeriod", attributes: ["id", "month", "year", "type"] },
          { model: db.User, as: "deletedBy", attributes: ["id", "name", "lastname"] },
        ],
        order: [["created_at", "DESC"]],
      });

      const visible = alerts.filter((a) => !(a.dismissed_by || []).includes(req.user.id));

      return res.status(200).json({ data: visible });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  dismiss: async (req, res) => {
    try {
      const alert = await db.SalaryAdvanceDeletionAlert.findByPk(req.params.id);
      if (!alert) return res.status(404).json({ error: "Aviso no encontrado." });

      const dismissedBy = alert.dismissed_by || [];
      if (!dismissedBy.includes(req.user.id)) {
        await alert.update({ dismissed_by: [...dismissedBy, req.user.id] });
      }

      return res.status(200).json({ data: alert });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
