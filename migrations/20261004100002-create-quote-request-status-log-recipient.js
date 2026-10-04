"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("quote_request_status_log_recipient", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      log_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "QuoteRequestStatusLogs", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
      user_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Users", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("quote_request_status_log_recipient", ["log_id", "user_id"], { unique: true });
  },
  async down(queryInterface) {
    await queryInterface.dropTable("quote_request_status_log_recipient");
  },
};
