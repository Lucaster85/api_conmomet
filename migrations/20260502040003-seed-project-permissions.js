"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const permissions = ["projects_read", "projects_write", "projects_update", "projects_delete"];
    const now = new Date();

    for (const name of permissions) {
      // Check if already exists
      const [existing] = await queryInterface.sequelize.query(
        `SELECT id FROM Permissions WHERE name = '${name}' AND deleted_at IS NULL LIMIT 1`
      );
      if (existing.length === 0) {
        await queryInterface.bulkInsert("Permissions", [
          { name, created_at: now, updated_at: now },
        ]);
      }
    }
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete("Permissions", {
      name: ["projects_read", "projects_write", "projects_update", "projects_delete"],
    });
  },
};
