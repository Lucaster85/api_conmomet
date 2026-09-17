"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const permissions = [
      "salary_advance_deletion_alerts_read",
      "salary_advance_deletion_alerts_update",
    ];
    const now = new Date();

    for (const name of permissions) {
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
        "salary_advance_deletion_alerts_read",
        "salary_advance_deletion_alerts_update",
      ],
    });
  },
};
