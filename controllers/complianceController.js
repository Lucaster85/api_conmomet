const complianceService = require("../services/complianceService");

module.exports = {
  /**
   * GET /plants/:id/compliance
   * Returns compliance status for all active employees against a plant's requirements.
   */
  getPlantCompliance: async (req, res) => {
    try {
      const result = await complianceService.getPlantCompliance(req.params.id);
      return res.status(200).json({ data: result });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  /**
   * GET /projects/:id/team
   * Returns the project team (employees who logged hours) with compliance data.
   */
  getProjectTeam: async (req, res) => {
    try {
      const result = await complianceService.getProjectTeam(req.params.id);
      if (!result) return res.status(404).json({ error: "Proyecto no encontrado." });
      return res.status(200).json({ data: result });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
