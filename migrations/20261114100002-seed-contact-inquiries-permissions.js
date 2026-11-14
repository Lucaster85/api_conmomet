"use strict";

const PERMISSIONS = [
  "contact_inquiries_read",
  "contact_inquiries_update",
  "contact_inquiries_delete",
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

    // Se siembran en los roles que hoy ven los Pedidos de Cotización (quote_requests_read): quien
    // atiende a clientes y arma presupuestos es quien recibe las consultas de la web. _write no
    // existe a propósito: las consultas solo se crean desde el formulario público.
    const roles = await queryInterface.sequelize.query(
      `SELECT DISTINCT rp.role_id FROM role_permission rp
       INNER JOIN Permissions p ON p.id = rp.permission_id
       WHERE p.name = 'quote_requests_read' AND p.deleted_at IS NULL AND rp.deleted_at IS NULL`,
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
