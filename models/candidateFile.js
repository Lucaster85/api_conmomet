"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

// Papeles de un postulante (CV, carta, certificados). NO se reusa EntityDocument a propósito: sus
// archivos aparecen en el aviso de vencimientos (DocumentExpirationAlert) y son visibles con
// `documents_read`, y un CV no tiene vencimiento ni lo tiene que ver quien administra documentación
// (ver FLOWS.md §59). Mismas columnas de archivo que QuoteRequestFile; el visor las abre con
// openFile/fileLinkProps (URL firmada en el momento, ver §57).
//
// `uploaded_by` es nullable: los envíos desde la web (etapa 3) no tienen usuario.
module.exports = () => {
  class CandidateFile extends Model {
    static associate(models) {
      CandidateFile.belongsTo(models.Candidate, { foreignKey: "candidate_id", as: "candidate" });
      CandidateFile.belongsTo(models.CandidateApplication, { foreignKey: "application_id", as: "application" });
      CandidateFile.belongsTo(models.User, { foreignKey: "uploaded_by", as: "uploader" });
    }
  }
  CandidateFile.init(
    {
      candidate_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Candidates", key: "id" },
      },
      application_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "CandidateApplications", key: "id" },
      },
      kind: {
        type: DataTypes.ENUM("cv", "cover_letter", "certificate", "other"),
        allowNull: false,
        defaultValue: "other",
      },
      file_url: { type: DataTypes.STRING(500), allowNull: false },
      file_key: { type: DataTypes.STRING(500) },
      file_name: { type: DataTypes.STRING(255) },
      mime_type: { type: DataTypes.STRING(120) },
      size_bytes: { type: DataTypes.INTEGER },
      uploaded_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
      },
    },
    {
      sequelize,
      modelName: "CandidateFile",
      tableName: "CandidateFiles",
      timestamps: true,
      paranoid: true,
      underscored: true,
    }
  );
  return CandidateFile;
};
