"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("BudgetMaterialItems", "provider_id", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Providers", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
      comment: "Proveedor del que se tomó el costo — null en líneas legacy sin vincular al catálogo",
    });
    await queryInterface.addIndex("BudgetMaterialItems", ["provider_id"]);
    await queryInterface.sequelize.query(`
      UPDATE BudgetMaterialItems
      SET provider_id = (SELECT id FROM Providers WHERE is_system = true LIMIT 1)
      WHERE provider_id IS NULL AND material_id IS NOT NULL
    `);
  },
  async down(queryInterface) {
    await queryInterface.removeColumn("BudgetMaterialItems", "provider_id");
  },
};
