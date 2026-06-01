"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const permissions = [
      "ocas_read",
      "ocas_write",
      "ocas_update",
      "ocas_delete",
      "vehicles_read",
      "vehicles_write",
      "vehicles_update",
      "vehicles_delete",
      "client_supervisors_read",
      "client_supervisors_write",
      "client_supervisors_update",
      "client_supervisors_delete",
    ];
    const now = new Date();

    for (const name of permissions) {
      // Check if already exists
      const [existing] = await queryInterface.sequelize.query(
        `SELECT id FROM Permissions WHERE name = :name AND deleted_at IS NULL LIMIT 1`,
        {
          replacements: { name },
          type: queryInterface.sequelize.QueryTypes.SELECT,
        }
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
        "ocas_read",
        "ocas_write",
        "ocas_update",
        "ocas_delete",
        "vehicles_read",
        "vehicles_write",
        "vehicles_update",
        "vehicles_delete",
        "client_supervisors_read",
        "client_supervisors_write",
        "client_supervisors_update",
        "client_supervisors_delete",
      ],
    });
  },
};
