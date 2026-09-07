const db = require("../models");

module.exports = {
  // GET /system-settings — verifyToken únicamente, sin authPermission: cualquier usuario
  // logueado puede necesitar leer esto (ej. validar el tope antes de mandar un pedido desde
  // el portal), no solo administración.
  get: async (req, res) => {
    try {
      const settings = await db.SystemSetting.findByPk(1);
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

      await settings.save();
      return res.status(200).json({ data: settings });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
