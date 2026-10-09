"use strict";

// Permiso separado de `safety_equipment_read` a propósito: varios perfiles van a tener acceso
// al módulo de EPP (para registrar entregas), pero el aviso de vencimientos en el inicio del
// dashboard solo debe verlo quien gestiona personal — mismo criterio que
// `salary_advance_deletion_alerts_read`. No se asigna a ningún rol acá: se asigna desde la
// pantalla de Roles después del deploy.
const PERMISSIONS = ["safety_equipment_alerts_read"];

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
