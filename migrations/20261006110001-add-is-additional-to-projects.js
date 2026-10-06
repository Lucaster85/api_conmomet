"use strict";
const { DataTypes } = require("sequelize");

/**
 * Marca explícita de "adicional": un proyecto urgente que arranca sin pedido de cotización ni
 * presupuesto aprobado, con o sin proyecto padre. Antes se deducía de parent_id. Los hijos
 * existentes (subproyectos P-2026-063.1) quedan marcados y conservan su código.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("Projects", "is_additional", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addIndex("Projects", ["is_additional"], { name: "projects_is_additional" });
    await queryInterface.sequelize.query("UPDATE Projects SET is_additional = true WHERE parent_id IS NOT NULL");
  },
  async down(queryInterface) {
    await queryInterface.removeIndex("Projects", "projects_is_additional");
    await queryInterface.removeColumn("Projects", "is_additional");
  },
};
