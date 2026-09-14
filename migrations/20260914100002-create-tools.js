"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("Tools", {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: DataTypes.INTEGER,
      },
      tool_type_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "ToolTypes", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      name: {
        type: DataTypes.STRING(150),
        allowNull: false,
      },
      // Cargado manualmente una vez creada la herramienta — no editable después (ver
      // toolController.js#update, que nunca acepta este campo).
      reference_code: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true,
      },
      brand: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      model: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      serial_number: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("available", "reserved", "delivered", "in_repair", "retired", "lost"),
        allowNull: false,
        defaultValue: "available",
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

    await queryInterface.addIndex("Tools", ["tool_type_id"]);
    await queryInterface.addIndex("Tools", ["status"]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable("Tools");
  },
};
