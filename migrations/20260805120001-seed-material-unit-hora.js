"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const [existing] = await queryInterface.sequelize.query(
      "SELECT id FROM MaterialUnits WHERE label = 'hora' LIMIT 1"
    );
    if (existing.length > 0) return;

    const [[{ maxOrder }]] = await queryInterface.sequelize.query(
      "SELECT COALESCE(MAX(display_order), 0) AS maxOrder FROM MaterialUnits"
    );

    const now = new Date();
    await queryInterface.bulkInsert("MaterialUnits", [
      { label: "hora", display_order: maxOrder + 1, is_active: true, created_at: now, updated_at: now },
    ]);
  },
  async down(queryInterface) {
    await queryInterface.bulkDelete("MaterialUnits", { label: "hora" });
  },
};
