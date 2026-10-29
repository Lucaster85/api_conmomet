const { getUsdRateConfig } = require("../helpers/systemSettings");
const { fetchCurrentUsdRate } = require("../services/exchangeRateService");

module.exports = {
  // GET /exchange-rates/current — verifyToken únicamente (mismo criterio que GET
  // /system-settings): lo necesita cualquiera que esté armando un préstamo en USD, no solo
  // administración con permiso de préstamos. Devuelve null sin romper si la API no responde.
  getCurrent: async (req, res) => {
    try {
      const config = await getUsdRateConfig();
      const rate = await fetchCurrentUsdRate(config);
      return res.status(200).json({ data: rate });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
