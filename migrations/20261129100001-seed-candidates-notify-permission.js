"use strict";

// Permiso para RECIBIR los avisos de postulantes nuevos (campanita y push), separado de candidates_read (FLOWS.md §83).
// candidates_read también da el menú, el tablero y el acceso a la API, y `admin_granted` lo incluye siempre: con eso no se podía
// avisar solo a quien atiende las postulaciones. Este se chequea por nombre exacto (sin el bypass de admin_granted).
// Solo crea el registro: no se asigna a nadie. Se da desde Roles (o como permiso particular de un usuario) después del deploy.
const PERMISSIONS = ["candidates_notify"];

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
