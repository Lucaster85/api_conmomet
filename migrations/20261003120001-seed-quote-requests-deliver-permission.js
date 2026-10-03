"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Separa "entregar el presupuesto a gerencia" (in_progress -> pending_review, acción del
    // responsable) de "gestionar el PC" (quote_requests_assign: crear, editar, reasignar, cerrar,
    // cancelar — acciones de gerencia). Antes las dos caían bajo quote_requests_update, el
    // permiso que deriva la ruta PUT, así que el responsable también podía cambiarle el
    // vencimiento o reasignarse el PC. Mismo patrón granular que budgets_send (ver FLOWS.md 27d).
    const permissions = ["quote_requests_deliver"];
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
    await queryInterface.bulkDelete("Permissions", { name: ["quote_requests_deliver"] });
  },
};
