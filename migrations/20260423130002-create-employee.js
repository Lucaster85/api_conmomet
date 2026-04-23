"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("Employees", {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: DataTypes.INTEGER,
      },
      name: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      lastname: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      dni: {
        type: DataTypes.STRING(10),
        allowNull: false,
        unique: true,
      },
      cuil: {
        type: DataTypes.STRING(13),
        allowNull: false,
        unique: true,
      },
      address: {
        type: DataTypes.STRING(255),
      },
      phone: {
        type: DataTypes.STRING(30),
      },
      email: {
        type: DataTypes.STRING(255),
      },
      position: {
        type: DataTypes.STRING(100),
      },
      hire_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      termination_date: {
        type: DataTypes.DATEONLY,
      },
      status: {
        type: DataTypes.ENUM("active", "inactive", "vacation", "medical_leave"),
        defaultValue: "active",
      },
      hourly_rate: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      user_id: {
        type: DataTypes.INTEGER,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      notes: {
        type: DataTypes.TEXT,
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
      },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable("Employees");
  },
};
