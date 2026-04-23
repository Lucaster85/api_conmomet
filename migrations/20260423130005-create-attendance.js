"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("Attendances", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      employee_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Employees", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      date: { type: DataTypes.DATEONLY, allowNull: false },
      status: { type: DataTypes.ENUM("absent", "justified", "vacation", "medical_leave"), allowNull: false },
      notes: { type: DataTypes.TEXT },
      document_url: { type: DataTypes.STRING(500) },
      document_key: { type: DataTypes.STRING(500) },
      document_name: { type: DataTypes.STRING(255) },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      deleted_at: { type: DataTypes.DATE },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable("Attendances");
  },
};
