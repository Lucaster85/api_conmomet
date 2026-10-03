"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Permiso granular aparte de budgets_update: gatea solo la transición draft -> sent (poner
    // el presupuesto en manos del cliente), no el acceso al módulo ni la edición. Nace del flujo
    // de Pedidos de Cotización: el responsable que arma el presupuesto tiene budgets_update para
    // cargar rubros y materiales, pero NO debe poder enviarlo — solo entregárselo a gerencia
    // (PC -> pending_review), y gerencia es quien envía. Mismo patrón que budget_prices_read y
    // quote_requests_assign (ver FLOWS.md flujo 25 y 27).
    const permissions = ["budgets_send"];
    const now = new Date();

    for (const name of permissions) {
      const [existing] = await queryInterface.sequelize.query(
        `SELECT id FROM Permissions WHERE name = :name AND deleted_at IS NULL LIMIT 1`,
        { replacements: { name }, type: queryInterface.sequelize.QueryTypes.SELECT }
      );
      if (!existing) {
        await queryInterface.bulkInsert("Permissions", [
          { name, created_at: now, updated_at: now },
        ]);
      }
    }
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete("Permissions", { name: ["budgets_send"] });
  },
};
