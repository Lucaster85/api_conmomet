"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // El recurso /salary-advances nunca tuvo sus permisos sembrados (a diferencia de otros
    // módulos como loans o tools), por eso no aparecían como checkbox en "permisos adicionales
    // por usuario" ni al armar un rol nuevo. Se agregan los 4 (read/write/update/delete) para
    // poder asignarlos puntualmente a usuarios específicos sin necesidad de admin_granted.
    const permissions = [
      "salary_advances_read",
      "salary_advances_write",
      "salary_advances_update",
      "salary_advances_delete",
    ];
    const now = new Date();

    for (const name of permissions) {
      const [existing] = await queryInterface.sequelize.query(
        `SELECT id FROM Permissions WHERE name = :name AND deleted_at IS NULL LIMIT 1`,
        {
          replacements: { name },
          type: queryInterface.sequelize.QueryTypes.SELECT,
        }
      );
      if (!existing) {
        await queryInterface.bulkInsert("Permissions", [
          { name, created_at: now, updated_at: now },
        ]);
      }
    }
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete("Permissions", {
      name: [
        "salary_advances_read",
        "salary_advances_write",
        "salary_advances_update",
        "salary_advances_delete",
      ],
    });
  },
};
