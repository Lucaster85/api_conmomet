"use strict";

// Permisos del módulo Adicionales (/additionals). Solo crea los registros: no se asignan a ningún
// rol — se asignan desde la pantalla de Roles después del deploy. Mismo patrón que
// 20261002100005-seed-quote-requests-permissions.js.
const PERMISSIONS = ["additionals_read", "additionals_write", "additionals_update", "additionals_delete"];

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
