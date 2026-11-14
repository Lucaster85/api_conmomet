"use strict";
const { DataTypes } = require("sequelize");

const SOURCES = ["web", "in_person", "referral", "other"];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("CandidateApplications", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      candidate_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Candidates", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      stage: {
        type: DataTypes.ENUM("new", "screening", "interview", "offer", "hired", "rejected", "withdrawn"),
        allowNull: false,
        defaultValue: "new",
      },
      position_of_interest: { type: DataTypes.STRING(100), allowNull: true },
      cover_letter: { type: DataTypes.TEXT, allowNull: true },
      rejection_reason: {
        type: DataTypes.ENUM("profile_mismatch", "no_vacancies", "no_response", "failed_interview", "salary_expectations", "other"),
        allowNull: true,
      },
      rejection_notes: { type: DataTypes.TEXT, allowNull: true },
      source: { type: DataTypes.ENUM(...SOURCES), allowNull: false, defaultValue: "in_person" },
      applied_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      // Snapshot de lo enviado desde la web (etapa 3); null en la carga interna.
      submitted_data: { type: DataTypes.JSON, allowNull: true },
      created_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("CandidateApplications", ["candidate_id", "stage"], { name: "candidate_applications_candidate_stage_idx" });
    await queryInterface.addIndex("CandidateApplications", ["stage", "applied_at"], { name: "candidate_applications_stage_idx" });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("CandidateApplications");
  },
};
