"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("CandidateInterviews", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      application_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "CandidateApplications", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      scheduled_at: { type: DataTypes.DATE, allowNull: false },
      duration_minutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 60 },
      modality: { type: DataTypes.ENUM("in_person", "phone", "video"), allowNull: false, defaultValue: "in_person" },
      location: { type: DataTypes.STRING(255), allowNull: true },
      status: {
        type: DataTypes.ENUM("scheduled", "completed", "cancelled", "no_show"),
        allowNull: false,
        defaultValue: "scheduled",
      },
      rating: { type: DataTypes.INTEGER, allowNull: true },
      recommendation: { type: DataTypes.ENUM("advance", "hold", "reject"), allowNull: true },
      feedback: { type: DataTypes.TEXT, allowNull: true },
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
    await queryInterface.addIndex("CandidateInterviews", ["application_id"], { name: "candidate_interviews_application_idx" });
    // Para el aviso de "entrevistas de hoy y mañana".
    await queryInterface.addIndex("CandidateInterviews", ["status", "scheduled_at"], { name: "candidate_interviews_upcoming_idx" });

    await queryInterface.createTable("candidate_interview_interviewer", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      interview_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "CandidateInterviews", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
      user_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Users", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("candidate_interview_interviewer", ["interview_id", "user_id"], { unique: true, name: "candidate_interview_interviewer_unique" });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("candidate_interview_interviewer");
    await queryInterface.dropTable("CandidateInterviews");
  },
};
