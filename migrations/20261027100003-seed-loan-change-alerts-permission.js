"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const name = "loan_change_alerts_read";
    const now = new Date();

    let [permission] = await queryInterface.sequelize.query(
      `SELECT id FROM Permissions WHERE name = :name AND deleted_at IS NULL LIMIT 1`,
      { replacements: { name }, type: queryInterface.sequelize.QueryTypes.SELECT }
    );
    if (!permission) {
      await queryInterface.bulkInsert("Permissions", [
        { name, created_at: now, updated_at: now },
      ]);
      [permission] = await queryInterface.sequelize.query(
        `SELECT id FROM Permissions WHERE name = :name AND deleted_at IS NULL LIMIT 1`,
        { replacements: { name }, type: queryInterface.sequelize.QueryTypes.SELECT }
      );
    }

    // Mismo perfil superior que ya ve la anulación de adelantos pagados: cualquier rol con
    // salary_advance_deletion_alerts_read recibe este aviso sin configurar nada a mano.
    const rolesWithAdvanceAlert = await queryInterface.sequelize.query(
      `SELECT rp.role_id FROM role_permission rp
       INNER JOIN Permissions p ON p.id = rp.permission_id
       WHERE p.name = 'salary_advance_deletion_alerts_read' AND p.deleted_at IS NULL AND rp.deleted_at IS NULL`,
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    );

    for (const { role_id } of rolesWithAdvanceAlert) {
      const [existingAssignment] = await queryInterface.sequelize.query(
        `SELECT id FROM role_permission WHERE role_id = :role_id AND permission_id = :permission_id AND deleted_at IS NULL LIMIT 1`,
        { replacements: { role_id, permission_id: permission.id }, type: queryInterface.sequelize.QueryTypes.SELECT }
      );
      if (!existingAssignment) {
        await queryInterface.bulkInsert("role_permission", [
          { role_id, permission_id: permission.id, created_at: now, updated_at: now },
        ]);
      }
    }
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete("Permissions", { name: "loan_change_alerts_read" });
  },
};
