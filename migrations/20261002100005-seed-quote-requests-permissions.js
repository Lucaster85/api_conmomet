"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const permissions = [
      "quote_requests_read",
      "quote_requests_write",
      "quote_requests_update",
      "quote_requests_delete",
      // Permiso granular aparte de quote_requests_write — "quién puede cargar un PC y asignar
      // responsables" (el "perfil gerencia" del pedido original), sin anclarlo a ningún rol
      // concreto. Mismo criterio que budget_prices_read (ver FLOWS.md flujo 25).
      "quote_requests_assign",
    ];
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
    await queryInterface.bulkDelete("Permissions", {
      name: [
        "quote_requests_read",
        "quote_requests_write",
        "quote_requests_update",
        "quote_requests_delete",
        "quote_requests_assign",
      ],
    });
  },
};
