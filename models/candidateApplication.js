"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

// Una POSTULACIÓN: la persona (Candidate) presentándose, con su etapa (ver FLOWS.md §59). Hoy solo
// existe la postulación espontánea. Para sumar búsquedas publicadas más adelante alcanza con una
// tabla JobOpenings y una columna nullable `job_opening_id` acá — por eso no está todavía.
//
// Sin soft delete a propósito: una postulación nunca se borra suelta, se cierra (rechazada /
// retirada). Desaparece solo junto con su candidato (FK en cascada).
module.exports = () => {
  class CandidateApplication extends Model {
    static associate(models) {
      CandidateApplication.belongsTo(models.Candidate, { foreignKey: "candidate_id", as: "candidate" });
      CandidateApplication.belongsTo(models.User, { foreignKey: "created_by", as: "createdByUser" });
      CandidateApplication.hasMany(models.CandidateFile, { foreignKey: "application_id", as: "files" });
      CandidateApplication.hasMany(models.CandidateApplicationLog, { foreignKey: "application_id", as: "logs" });
      CandidateApplication.hasMany(models.CandidateInterview, { foreignKey: "application_id", as: "interviews" });
    }
  }
  CandidateApplication.init(
    {
      candidate_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Candidates", key: "id" },
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
      source: {
        type: DataTypes.ENUM("web", "in_person", "referral", "other"),
        allowNull: false,
        defaultValue: "in_person",
      },
      applied_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      // Snapshot de lo que mandó la persona desde la web (etapa 3), tal cual, aunque después se
      // completen o corrijan los datos del Candidate. Null en la carga interna.
      submitted_data: { type: DataTypes.JSON, allowNull: true },
      created_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
      },
    },
    {
      sequelize,
      modelName: "CandidateApplication",
      tableName: "CandidateApplications",
      timestamps: true,
      underscored: true,
    }
  );
  return CandidateApplication;
};
