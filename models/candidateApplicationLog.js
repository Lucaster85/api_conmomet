"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

// Historial append-only de una postulación (ver FLOWS.md §59). Mismo patrón que
// QuoteRequestStatusLog: `event` explícito en vez de derivarlo de (from_stage, to_stage), y
// `comment` porque Candidate/Application ya usan `notes` con otro significado.
// `changed_by` es nullable: los eventos de la web (alta, reenvío de CV) no tienen usuario.
module.exports = () => {
  class CandidateApplicationLog extends Model {
    static associate(models) {
      CandidateApplicationLog.belongsTo(models.CandidateApplication, { foreignKey: "application_id", as: "application" });
      CandidateApplicationLog.belongsTo(models.User, { foreignKey: "changed_by", as: "changedByUser" });
    }
  }
  CandidateApplicationLog.init(
    {
      application_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "CandidateApplications", key: "id" },
      },
      event: {
        type: DataTypes.STRING(30),
        allowNull: false,
        comment: "created / stage_changed / reopened / resubmitted / converted",
      },
      from_stage: { type: DataTypes.STRING(20), allowNull: true },
      to_stage: { type: DataTypes.STRING(20), allowNull: true },
      comment: { type: DataTypes.TEXT, allowNull: true },
      changed_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
      },
      changed_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    {
      sequelize,
      modelName: "CandidateApplicationLog",
      tableName: "CandidateApplicationLogs",
      timestamps: true,
      underscored: true,
      // Sin paranoid: log append-only, una fila nunca se edita ni se borra (salvo en cascada con su postulación).
    }
  );
  return CandidateApplicationLog;
};
