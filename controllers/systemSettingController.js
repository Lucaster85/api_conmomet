const db = require("../models");

module.exports = {
  // GET /system-settings — verifyToken únicamente, sin authPermission: cualquier usuario
  // logueado puede necesitar leer esto (ej. validar el tope antes de mandar un pedido desde
  // el portal), no solo administración.
  get: async (req, res) => {
    try {
      const settings = await db.SystemSetting.findByPk(1, {
        include: [{ model: db.User, as: "ocaBudgetNotificationUser", attributes: ["id", "name", "lastname"] }],
      });
      if (!settings) return res.status(404).json({ error: "Configuración no encontrada." });
      return res.status(200).json({ data: settings });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // PUT /system-settings — admin únicamente (authPermission).
  update: async (req, res) => {
    try {
      const { max_loan_amount_ars } = req.body;

      const settings = await db.SystemSetting.findByPk(1);
      if (!settings) return res.status(404).json({ error: "Configuración no encontrada." });

      if (max_loan_amount_ars !== undefined && max_loan_amount_ars !== null) {
        const value = Number(max_loan_amount_ars);
        if (!(value > 0)) {
          return res.status(400).json({ error: "El tope de préstamo debe ser mayor a cero." });
        }
        settings.max_loan_amount_ars = value;
      }

      if (req.body.oca_budget_notification_user_id !== undefined) {
        settings.oca_budget_notification_user_id = req.body.oca_budget_notification_user_id;
      }

      // Alícuotas de IVA de Facturación: lista de números entre 0 y 100, hasta 2 decimales, sin
      // repetidos y con al menos una. Las facturas ya cargadas guardan su propia alícuota, así
      // que quitar una de la lista no las toca.
      if (req.body.invoice_iva_rates !== undefined) {
        const raw = req.body.invoice_iva_rates;
        if (!Array.isArray(raw) || raw.length === 0) {
          return res.status(400).json({ error: "Tiene que haber al menos una alícuota de IVA." });
        }
        const rates = raw.map((r) => Number(r));
        if (rates.some((r) => !Number.isFinite(r) || r < 0 || r > 100 || Math.abs(Math.round(r * 100) - r * 100) > 1e-9)) {
          return res.status(400).json({ error: "Las alícuotas de IVA deben ser números entre 0 y 100, con hasta 2 decimales." });
        }
        if (new Set(rates).size !== rates.length) {
          return res.status(400).json({ error: "Hay alícuotas de IVA repetidas." });
        }
        settings.invoice_iva_rates = rates.sort((a, b) => a - b);
      }

      await settings.save();
      return res.status(200).json({ data: settings });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
