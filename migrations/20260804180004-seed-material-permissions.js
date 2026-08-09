"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const permissions = [
      "materials_read",
      "materials_write",
      "materials_update",
      "materials_delete",
      // Separado de materials_read a propósito: gatea ver/editar el costo real y el margen,
      // no el catálogo en sí (buscar/elegir un material para una línea no requiere esto).
      "material_costs_read",
    ];
    const now = new Date();

    for (const name of permissions) {
      const [existing] = await queryInterface.sequelize.query(
        `SELECT id FROM Permissions WHERE name = :name AND deleted_at IS NULL LIMIT 1`,
        { replacements: { name }, type: queryInterface.sequelize.QueryTypes.SELECT }
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
        "materials_read",
        "materials_write",
        "materials_update",
        "materials_delete",
        "material_costs_read",
      ],
    });
  },
};
