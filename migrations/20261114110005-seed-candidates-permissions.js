"use strict";

const PERMISSIONS = [
  "candidates_read",
  "candidates_write",
  "candidates_update",
  "candidates_delete",
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const { QueryTypes } = queryInterface.sequelize;
    const now = new Date();

    const permissionIds = [];
    for (const name of PERMISSIONS) {
      let [permission] = await queryInterface.sequelize.query(
        `SELECT id FROM Permissions WHERE name = :name AND deleted_at IS NULL LIMIT 1`,
        { replacements: { name }, type: QueryTypes.SELECT }
      );
      if (!permission) {
        await queryInterface.bulkInsert("Permissions", [{ name, created_at: now, updated_at: now }]);
        [permission] = await queryInterface.sequelize.query(
          `SELECT id FROM Permissions WHERE name = :name AND deleted_at IS NULL LIMIT 1`,
          { replacements: { name }, type: QueryTypes.SELECT }
        );
      }
      permissionIds.push(permission.id);
    }

    // Se siembran en los roles que hoy pueden dar de alta empleados (employees_write): quien
    // contrata es quien recibe y carga a los postulantes (ver FLOWS.md §59).
    const roles = await queryInterface.sequelize.query(
      `SELECT DISTINCT rp.role_id FROM role_permission rp
       INNER JOIN Permissions p ON p.id = rp.permission_id
       WHERE p.name = 'employees_write' AND p.deleted_at IS NULL AND rp.deleted_at IS NULL`,
      { type: QueryTypes.SELECT }
    );

    for (const { role_id } of roles) {
      for (const permission_id of permissionIds) {
        const [assigned] = await queryInterface.sequelize.query(
          `SELECT id FROM role_permission WHERE role_id = :role_id AND permission_id = :permission_id AND deleted_at IS NULL LIMIT 1`,
          { replacements: { role_id, permission_id }, type: QueryTypes.SELECT }
        );
        if (!assigned) {
          await queryInterface.bulkInsert("role_permission", [
            { role_id, permission_id, created_at: now, updated_at: now },
          ]);
        }
      }
    }
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete("Permissions", { name: PERMISSIONS });
  },
};
