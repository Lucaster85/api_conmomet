"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const name = "budget_prices_read";
    const now = new Date();

    const [existing] = await queryInterface.sequelize.query(
      `SELECT id FROM Permissions WHERE name = :name AND deleted_at IS NULL LIMIT 1`,
      { replacements: { name }, type: queryInterface.sequelize.QueryTypes.SELECT }
    );
    if (!existing) {
      await queryInterface.bulkInsert("Permissions", [
        { name, created_at: now, updated_at: now },
      ]);
    }
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete("Permissions", { name: "budget_prices_read" });
  },
};
