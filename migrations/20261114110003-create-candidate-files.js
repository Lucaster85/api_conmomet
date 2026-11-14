"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("CandidateFiles", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      candidate_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Candidates", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      application_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "CandidateApplications", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      kind: {
        type: DataTypes.ENUM("cv", "cover_letter", "certificate", "other"),
        allowNull: false,
        defaultValue: "other",
      },
      file_url: { type: DataTypes.STRING(500), allowNull: false },
      file_key: { type: DataTypes.STRING(500), allowNull: true },
      file_name: { type: DataTypes.STRING(255), allowNull: true },
      mime_type: { type: DataTypes.STRING(120), allowNull: true },
      size_bytes: { type: DataTypes.INTEGER, allowNull: true },
      // Nullable: los envíos desde la web no tienen usuario.
      uploaded_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
    });
    await queryInterface.addIndex("CandidateFiles", ["candidate_id"], { name: "candidate_files_candidate_idx" });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("CandidateFiles");
  },
};
