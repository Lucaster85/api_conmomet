"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("QuoteRequestFiles", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      quote_request_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "QuoteRequests", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
      file_url: { type: DataTypes.STRING(500), allowNull: false },
      file_key: { type: DataTypes.STRING(500) },
      file_name: { type: DataTypes.STRING(255) },
      mime_type: { type: DataTypes.STRING(120) },
      size_bytes: { type: DataTypes.INTEGER },
      uploaded_by: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Users", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      deleted_at: { type: DataTypes.DATE },
    });
    await queryInterface.addIndex("QuoteRequestFiles", ["quote_request_id"]);
  },
  async down(queryInterface) {
    await queryInterface.dropTable("QuoteRequestFiles");
  },
};
