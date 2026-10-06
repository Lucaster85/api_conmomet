"use strict";
const { DataTypes } = require("sequelize");

/**
 * Providers era un stub sin uso. Se lo reutiliza para el precio de materiales por proveedor:
 * email deja de ser obligatorio (el ABM rápido solo carga el nombre) y se agrega is_system para
 * el proveedor "Sin especificar", que aloja los costos que hoy viven en Materials.current_cost.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("Providers", "is_system", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });

    const [existing] = await queryInterface.sequelize.query(
      "SELECT id FROM Providers WHERE is_system = true LIMIT 1"
    );
    if (existing.length === 0) {
      await queryInterface.bulkInsert("Providers", [{
        razon_social: "Sin especificar",
        is_system: true,
        created_at: new Date(),
        updated_at: new Date(),
      }]);
    }
  },
  async down(queryInterface) {
    await queryInterface.bulkDelete("Providers", { is_system: true });
    await queryInterface.removeColumn("Providers", "is_system");
  },
};
