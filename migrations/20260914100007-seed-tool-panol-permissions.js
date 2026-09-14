"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const permissions = [
      "tool_types_read",
      "tool_types_write",
      "tool_types_update",
      "tool_types_delete",
      "tools_read",
      "tools_write",
      "tools_update",
      "tools_delete",
      "asset_assignments_read",
      "asset_assignments_write",
      "asset_assignments_update",
      "asset_assignments_delete",
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
        "tool_types_read",
        "tool_types_write",
        "tool_types_update",
        "tool_types_delete",
        "tools_read",
        "tools_write",
        "tools_update",
        "tools_delete",
        "asset_assignments_read",
        "asset_assignments_write",
        "asset_assignments_update",
        "asset_assignments_delete",
      ],
    });
  },
};
