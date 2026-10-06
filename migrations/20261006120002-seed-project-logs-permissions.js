"use strict";

// Permisos de la bitácora de proyectos (/project-logs). Solo se leen y se agregan notas: no hay
// update ni delete (registro de solo agregar). No se asignan a ningún rol: se asignan desde la
// pantalla de Roles después del deploy (típicamente, a quienes encargan proyectos y adicionales).
const PERMISSIONS = ["project_logs_read", "project_logs_write"];

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
