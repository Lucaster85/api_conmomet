"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

// Texto de privacidad / consentimiento que acepta una persona al enviar un formulario público (hoy solo
// "Trabajá con nosotros", ver FLOWS.md §63). Editable desde Configuración General, pero NUNCA se pisa ni se
// borra: cada cambio es una `version` nueva. Es lo que hace que `Candidate.consent_version` signifique algo —
// con el texto guardado por versión se puede saber exactamente qué leyó y aceptó cada postulante (Ley 25.326).
//
// Sin paranoid ni update: es un registro append-only, mismo criterio que AuditLog. La "versión vigente" de un
// `kind` es la de mayor `version`.
module.exports = () => {
  class ConsentText extends Model {
    static associate(models) {
      ConsentText.belongsTo(models.User, { foreignKey: "created_by", as: "createdByUser" });
    }
  }
  ConsentText.init(
    {
      kind: { type: DataTypes.STRING(40), allowNull: false, defaultValue: "job_application" },
      version: { type: DataTypes.INTEGER, allowNull: false },
      content: { type: DataTypes.TEXT, allowNull: false },
      created_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
        comment: "null = texto inicial sembrado por la migración",
      },
    },
    {
      sequelize,
      modelName: "ConsentText",
      tableName: "ConsentTexts",
      timestamps: true,
      underscored: true,
      indexes: [{ unique: true, fields: ["kind", "version"] }],
    }
  );
  return ConsentText;
};
