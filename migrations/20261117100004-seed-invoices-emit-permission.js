"use strict";

// Permiso para emitir facturas por ARCA (PLAN_ARCA.md §8, S3). Emitir es irreversible, así que no alcanza con invoices_write.
// Cubre emitir y "Verificar en ARCA" (y más adelante NC/ND). Se chequea con requirePermission. Solo crea el registro: se asigna
// a un rol desde Roles después del deploy.
const PERMISSIONS = ["invoices_emit"];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const now = new Date();
    for (const name of PERMISSIONS) {
      const [existing] = await queryInterface.sequelize.query(
        `SELECT id FROM Permissions WHERE name = :name AND deleted_at IS NULL LIMIT 1`,
        { replacements: { name }, type: queryInterface.sequelize.QueryTypes.SELECT }
      );
      if (!existing) {
        await queryInterface.bulkInsert("Permissions", [{ name, created_at: now, updated_at: now }]);
      }
    }
  },
  async down(queryInterface) {
    await queryInterface.bulkDelete("Permissions", { name: PERMISSIONS });
  },
};
