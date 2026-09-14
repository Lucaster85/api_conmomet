"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Log de auditoría append-only (sin deleted_at) — espejo exacto de OcaStatusLogs.
    await queryInterface.createTable("ToolStatusLogs", {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: DataTypes.INTEGER,
      },
      tool_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Tools", key: "id" },
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

    await queryInterface.addIndex("ToolStatusLogs", ["tool_id"]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable("ToolStatusLogs");
  },
};
