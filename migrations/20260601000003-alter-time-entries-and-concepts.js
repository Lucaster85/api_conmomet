"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Alter PayrollConcepts
    await queryInterface.addColumn("PayrollConcepts", "is_crane_hours", {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    });

    // 2. Alter TimeEntries
    await queryInterface.addColumn("TimeEntries", "is_plant_hours", {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    });

    await queryInterface.addColumn("TimeEntries", "supervisor_id", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "ClientSupervisors", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });

    await queryInterface.addColumn("TimeEntries", "vehicle_id", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Vehicles", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });

    await queryInterface.addColumn("TimeEntries", "oca_id", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Ocas", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });

    // Add indexes to TimeEntries for the new columns
    await queryInterface.addIndex("TimeEntries", ["is_plant_hours"]);
    await queryInterface.addIndex("TimeEntries", ["supervisor_id"]);
    await queryInterface.addIndex("TimeEntries", ["vehicle_id"]);
    await queryInterface.addIndex("TimeEntries", ["oca_id"]);
  },

  async down(queryInterface) {
    // Remove indexes from TimeEntries
    await queryInterface.removeIndex("TimeEntries", ["is_plant_hours"]);
    await queryInterface.removeIndex("TimeEntries", ["supervisor_id"]);
    await queryInterface.removeIndex("TimeEntries", ["vehicle_id"]);
    await queryInterface.removeIndex("TimeEntries", ["oca_id"]);

    // Remove columns from TimeEntries
    await queryInterface.removeColumn("TimeEntries", "oca_id");
    await queryInterface.removeColumn("TimeEntries", "vehicle_id");
    await queryInterface.removeColumn("TimeEntries", "supervisor_id");
    await queryInterface.removeColumn("TimeEntries", "is_plant_hours");

    // Remove column from PayrollConcepts
    await queryInterface.removeColumn("PayrollConcepts", "is_crane_hours");
  },
};
