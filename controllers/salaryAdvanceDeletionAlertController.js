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

      // Devuelve TODOS los avisos, sin filtrar por descarte: desde FLOWS.md flujo 36 el acuse de
      // vista lo resuelve el frontend contra UserAlertViews, que además permite "mostrar los
      // vistos" y "volver a mostrar todo". Filtrar acá los escondería del backend y esas dos
      // acciones no tendrían nada que mostrar.
      //
      // `created_at` explícito: con `underscored: true` la columna es snake_case pero el atributo
      // del modelo es `createdAt`, así que el JSON salía sin `created_at` y el componente —que lo
      // lee, igual que su interface TS— mostraba "Anulado por X el Invalid Date". Mismo criterio
      // que additionalController.js:129 y notificationController.js.
      const data = alerts.map((a) => {
        const plain = a.toJSON();
        return { ...plain, created_at: plain.created_at || plain.createdAt };
      });

      return res.status(200).json({ data });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // DEPRECADO desde FLOWS.md flujo 36: el frontend ya no lo llama, usa POST /me/alert-views con
  // alert_type "salary_advance_deletion". Se conserva para no romper un cliente viejo en vuelo
  // durante el deploy; la columna dismissed_by que escribe ya no se lee en ningún lado.
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
