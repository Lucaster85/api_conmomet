"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("QuoteRequestStatusLogs", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      quote_request_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "QuoteRequests", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
      event: { type: DataTypes.STRING(30), allowNull: false },
      from_status: { type: DataTypes.STRING(50), allowNull: true },
      to_status: { type: DataTypes.STRING(50), allowNull: false },
      changed_by: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Users", key: "id" } },
      changed_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      comment: { type: DataTypes.TEXT, allowNull: true },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("QuoteRequestStatusLogs", ["quote_request_id"]);
  },
  async down(queryInterface) {
    await queryInterface.dropTable("QuoteRequestStatusLogs");
  },
};
