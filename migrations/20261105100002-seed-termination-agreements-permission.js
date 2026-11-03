"use strict";

const NAME = "termination_agreements_write";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const { QueryTypes } = queryInterface.sequelize;
    const now = new Date();

    let [permission] = await queryInterface.sequelize.query(
      `SELECT id FROM Permissions WHERE name = :name AND deleted_at IS NULL LIMIT 1`,
      { replacements: { name: NAME }, type: QueryTypes.SELECT }
    );
    if (!permission) {
      await queryInterface.bulkInsert("Permissions", [{ name: NAME, created_at: now, updated_at: now }]);
      [permission] = await queryInterface.sequelize.query(
        `SELECT id FROM Permissions WHERE name = :name AND deleted_at IS NULL LIMIT 1`,
        { replacements: { name: NAME }, type: QueryTypes.SELECT }
      );
    }

    // Mismos roles que ya tienen employee_terminations_confirm: quien decide la baja es quien
    // pacta y paga la indemnización.
    const roles = await queryInterface.sequelize.query(
      `SELECT DISTINCT rp.role_id FROM role_permission rp
       INNER JOIN Permissions p ON p.id = rp.permission_id
       WHERE p.name = 'employee_terminations_confirm' AND p.deleted_at IS NULL AND rp.deleted_at IS NULL`,
      { type: QueryTypes.SELECT }
    );
    for (const { role_id } of roles) {
      const [assigned] = await queryInterface.sequelize.query(
        `SELECT id FROM role_permission WHERE role_id = :role_id AND permission_id = :permission_id AND deleted_at IS NULL LIMIT 1`,
        { replacements: { role_id, permission_id: permission.id }, type: QueryTypes.SELECT }
      );
      if (!assigned) {
        await queryInterface.bulkInsert("role_permission", [{ role_id, permission_id: permission.id, created_at: now, updated_at: now }]);
      }
    }
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete("Permissions", { name: NAME });
  },
};
