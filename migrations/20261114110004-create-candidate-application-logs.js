"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("CandidateApplicationLogs", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      application_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "CandidateApplications", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      event: { type: DataTypes.STRING(30), allowNull: false },
      from_stage: { type: DataTypes.STRING(20), allowNull: true },
      to_stage: { type: DataTypes.STRING(20), allowNull: true },
      comment: { type: DataTypes.TEXT, allowNull: true },
      changed_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      changed_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("CandidateApplicationLogs", ["application_id", "changed_at"], { name: "candidate_application_logs_idx" });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("CandidateApplicationLogs");
  },
};
