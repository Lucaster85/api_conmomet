"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

// Nota rápida personal de un usuario (ver FLOWS.md, flujo de Notas rápidas). Es PRIVADA: vive en
// /me/* y todo el acceso filtra por el user_id del token — no hay permiso de rol que la gatee.
//
// paranoid a propósito: eliminar no pide confirmación en la UI, muestra "Deshacer", y deshacer es
// restaurar la fila. No hay índice único que choque con el soft delete (a diferencia de
// UserAlertView, que por eso no es paranoid).
//
// `entity_type` + `entity_id` es el vínculo a futuro con una entidad del sistema. Hoy siempre
// null: la lista blanca helpers/quickNoteEntityTypes.js está vacía y el controller rechaza
// cualquier vínculo. Las columnas ya existen para que habilitarlo no requiera otra migración.
module.exports = () => {
  class QuickNote extends Model {
    static associate(models) {
      QuickNote.belongsTo(models.User, { foreignKey: "user_id", as: "user" });
    }
  }
  QuickNote.init({
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Users", key: "id" },
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    due_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    completed_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    due_notified_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "Cuándo se avisó el vencimiento (campanita/push). null = sin avisar. Etapa 3.",
    },
    entity_type: {
      type: DataTypes.STRING(40),
      allowNull: true,
      comment: "Uno de helpers/quickNoteEntityTypes.js#QUICK_NOTE_ENTITY_TYPES (hoy vacío)",
    },
    entity_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "Polimórfico, sin FK",
    },
  }, {
    sequelize,
    modelName: "QuickNote",
    tableName: "QuickNotes",
    timestamps: true,
    paranoid: true,
    underscored: true,
  });
  return QuickNote;
};
