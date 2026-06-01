"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Ocas Table
    await queryInterface.createTable("Ocas", {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: DataTypes.INTEGER,
      },
      number: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true,
      },
      type: {
        type: DataTypes.ENUM("man_hours", "crane_hours"),
        allowNull: false,
      },
      date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      client_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Clients", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      supervisor_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "ClientSupervisors", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      project_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Projects", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      status: {
        type: DataTypes.ENUM("pendiente", "presentado", "aprobado", "rechazado", "anulado"),
        defaultValue: "pendiente",
        allowNull: false,
      },
      source_oca_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Ocas", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      approved_img_url: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      approved_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      approved_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      rejected_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      rejected_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      rejection_reason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      created_at: {
        allowNull: false,
        type: DataTypes.DATE,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updated_at: {
        allowNull: false,
        type: DataTypes.DATE,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      deleted_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    });

    // Add indexes for Ocas
    await queryInterface.addIndex("Ocas", ["client_id", "status"]);
    await queryInterface.addIndex("Ocas", ["supervisor_id"]);
    await queryInterface.addIndex("Ocas", ["project_id"]);

    // 2. OcaLines Table
    await queryInterface.createTable("OcaLines", {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: DataTypes.INTEGER,
      },
      oca_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Ocas", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      time_entry_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "TimeEntries", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      employee_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Employees", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      project_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Projects", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      vehicle_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Vehicles", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      check_in: {
        type: DataTypes.TIME,
        allowNull: true,
      },
      check_out: {
        type: DataTypes.TIME,
        allowNull: true,
      },
      regular_hours: {
        type: DataTypes.DECIMAL(6, 2),
        allowNull: false,
      },
      overtime_50_hours: {
        type: DataTypes.DECIMAL(4, 2),
        defaultValue: 0,
        allowNull: false,
      },
      overtime_100_hours: {
        type: DataTypes.DECIMAL(4, 2),
        defaultValue: 0,
        allowNull: false,
      },
      type: {
        type: DataTypes.ENUM("man_hours", "crane_hours"),
        allowNull: false,
      },
      task: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      created_at: {
        allowNull: false,
        type: DataTypes.DATE,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updated_at: {
        allowNull: false,
        type: DataTypes.DATE,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      deleted_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    });

    // Add indexes for OcaLines
    await queryInterface.addIndex("OcaLines", ["oca_id"]);
    await queryInterface.addIndex("OcaLines", ["time_entry_id"]);

    // 3. OcaStatusLogs Table
    await queryInterface.createTable("OcaStatusLogs", {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: DataTypes.INTEGER,
      },
      oca_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Ocas", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      from_status: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      to_status: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      changed_by: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      changed_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      created_at: {
        allowNull: false,
        type: DataTypes.DATE,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updated_at: {
        allowNull: false,
        type: DataTypes.DATE,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    // Add index for OcaStatusLogs
    await queryInterface.addIndex("OcaStatusLogs", ["oca_id"]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable("OcaStatusLogs");
    await queryInterface.dropTable("OcaLines");
    await queryInterface.dropTable("Ocas");
  },
};
