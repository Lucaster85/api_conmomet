"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const permissions = [
      "budget_item_types_read",
      "budget_item_types_write",
      "budget_item_types_update",
      "budget_item_types_delete",
      "budgets_read",
      "budgets_write",
      "budgets_update",
      "budgets_delete",
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
        "budget_item_types_read",
        "budget_item_types_write",
        "budget_item_types_update",
        "budget_item_types_delete",
        "budgets_read",
        "budgets_write",
        "budgets_update",
        "budgets_delete",
      ],
    });
  },
};
