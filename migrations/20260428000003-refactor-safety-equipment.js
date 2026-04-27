"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Add new columns
    await queryInterface.addColumn("SafetyEquipments", "epp_item_id", {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "EppItems", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    });
    await queryInterface.addColumn("SafetyEquipments", "size_delivered", {
      type: DataTypes.STRING(10),
    });
    await queryInterface.addColumn("SafetyEquipments", "quantity", {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    });

    // Remove legacy column (no data exists)
    await queryInterface.removeColumn("SafetyEquipments", "item_name");
  },
  async down(queryInterface) {
    // Re-add legacy column
    await queryInterface.addColumn("SafetyEquipments", "item_name", {
      type: DataTypes.STRING(150),
      allowNull: true,
    });

    // Remove new columns
    await queryInterface.removeColumn("SafetyEquipments", "quantity");
    await queryInterface.removeColumn("SafetyEquipments", "size_delivered");
    await queryInterface.removeColumn("SafetyEquipments", "epp_item_id");
  },
};
