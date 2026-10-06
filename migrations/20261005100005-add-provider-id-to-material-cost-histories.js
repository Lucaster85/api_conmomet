"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("MaterialCostHistories", "provider_id", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Providers", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    });
    await queryInterface.addIndex("MaterialCostHistories", ["provider_id"]);
    // Las entradas existentes eran del único costo que había → "Sin especificar".
    await queryInterface.sequelize.query(`
      UPDATE MaterialCostHistories
      SET provider_id = (SELECT id FROM Providers WHERE is_system = true LIMIT 1)
      WHERE provider_id IS NULL
    `);
  },
  async down(queryInterface) {
    await queryInterface.removeColumn("MaterialCostHistories", "provider_id");
  },
};
