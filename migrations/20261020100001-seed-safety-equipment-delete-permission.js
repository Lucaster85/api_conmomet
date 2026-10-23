"use strict";

// Permiso para eliminar una entrega de EPP mal cargada (error de carga, no cancelación de una
// entrega real). No existía ningún permiso "delete" para este recurso — authPermission lo
// deriva de la URL (`safety_equipment_delete`), pero hasta que no exista la fila en
// Permissions no se puede asignar a ningún rol desde la pantalla de Roles. No se asigna a
// ningún rol acá: se asigna desde esa pantalla después del deploy.
const PERMISSIONS = ["safety_equipment_delete"];

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
