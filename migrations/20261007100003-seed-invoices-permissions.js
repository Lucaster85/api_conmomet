"use strict";

// Permisos de Facturación (/invoices). Solo crea los registros: no se asignan a ningún rol — se
// asignan desde la pantalla de Roles después del deploy. Mismo patrón que
// 20261006110002-seed-additionals-permissions.js.
// - invoices_read/write/update: los resuelve el path de middlewares/auth.js.
// - invoices_delete: por convención de CRUD. No hay ruta DELETE (las facturas se anulan).
// - invoices_unofficial: cargar y ver los cobros "sin factura". Se chequea en el controller.
// - invoices_correct: corregir los datos de una factura ya cargada. Se chequea en el controller.
const PERMISSIONS = [
  "invoices_read", "invoices_write", "invoices_update", "invoices_delete",
  "invoices_unofficial", "invoices_correct",
];

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
