"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("Budgets", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      number: { type: DataTypes.STRING(30), allowNull: false, unique: true },
      title: { type: DataTypes.STRING(200), allowNull: false },
      client_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Clients", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      plant_id: { type: DataTypes.INTEGER, references: { model: "Plants", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
      status: { type: DataTypes.ENUM("draft", "sent", "approved", "rejected"), allowNull: false, defaultValue: "draft" },
      currency: { type: DataTypes.ENUM("ARS", "USD"), allowNull: false, defaultValue: "ARS" },
      parent_project_id: { type: DataTypes.INTEGER, references: { model: "Projects", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      project_id: { type: DataTypes.INTEGER, references: { model: "Projects", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
      description: { type: DataTypes.TEXT },
      sent_at: { type: DataTypes.DATE },
      approved_at: { type: DataTypes.DATE },
      rejected_at: { type: DataTypes.DATE },
      rejection_reason: { type: DataTypes.TEXT },
      notes: { type: DataTypes.TEXT },
      created_by: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Users", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      deleted_at: { type: DataTypes.DATE },
    });
    await queryInterface.addIndex("Budgets", ["parent_project_id"]);
    await queryInterface.addIndex("Budgets", ["project_id"]);
  },
  async down(queryInterface) {
    await queryInterface.dropTable("Budgets");
  },
};
