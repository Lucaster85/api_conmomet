"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

// Entrevista de una postulación (ver FLOWS.md §61). Es una entidad propia, no un campo de la
// postulación: una postulación puede tener varias (primera charla, entrevista técnica) y cada una
// tiene su fecha, sus entrevistadores y su resultado.
//
// Sin soft delete: una entrevista no se borra, se CANCELA (`status`), así el historial de lo que se
// agendó y no se hizo queda. Desaparece solo junto con su candidato (FK en cascada).
//
// `scheduled_at` se guarda con la zona de Sequelize (-03:00), igual que el resto de los DATETIME: la
// hora que se ve en pantalla es la de Argentina.
module.exports = () => {
  class CandidateInterview extends Model {
    static associate(models) {
      CandidateInterview.belongsTo(models.CandidateApplication, { foreignKey: "application_id", as: "application" });
      CandidateInterview.belongsTo(models.User, { foreignKey: "created_by", as: "createdByUser" });
      CandidateInterview.belongsToMany(models.User, {
        through: "candidate_interview_interviewer",
        as: "interviewers",
        foreignKey: "interview_id",
        otherKey: "user_id",
      });
    }
  }
  CandidateInterview.init(
    {
      application_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "CandidateApplications", key: "id" },
      },
      scheduled_at: { type: DataTypes.DATE, allowNull: false },
      duration_minutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 60 },
      modality: { type: DataTypes.ENUM("in_person", "phone", "video"), allowNull: false, defaultValue: "in_person" },
      location: { type: DataTypes.STRING(255), allowNull: true, comment: "Dirección, sala o link de la videollamada" },
      status: {
        type: DataTypes.ENUM("scheduled", "completed", "cancelled", "no_show"),
        allowNull: false,
        defaultValue: "scheduled",
      },
      rating: { type: DataTypes.INTEGER, allowNull: true, comment: "Puntaje de 1 a 5, se carga con el resultado" },
      recommendation: { type: DataTypes.ENUM("advance", "hold", "reject"), allowNull: true },
      feedback: { type: DataTypes.TEXT, allowNull: true },
      created_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
      },
    },
    {
      sequelize,
      modelName: "CandidateInterview",
      tableName: "CandidateInterviews",
      timestamps: true,
      underscored: true,
    }
  );
  return CandidateInterview;
};
