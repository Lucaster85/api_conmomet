"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class WorkDayLog extends Model {
    static associate(models) {
      WorkDayLog.belongsTo(models.Project, { foreignKey: "project_id", as: "project" });
    }
  }

  WorkDayLog.init(
    {
      project_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Projects", key: "id" },
      },
      date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      start_time: {
        type: DataTypes.TIME,
        allowNull: true,
        comment: "Hora de inicio de la jornada. Auto-sugerido desde TimeEntries, editable por el usuario.",
      },
      end_time: {
        type: DataTypes.TIME,
        allowNull: true,
        comment: "Hora de finalización de la jornada. Auto-sugerido desde TimeEntries, editable por el usuario.",
      },
      suspension_reason: {
        type: DataTypes.STRING(150),
        allowNull: true,
        comment: "Motivo de suspensión: Lluvias, Vientos, SEH, Corte de luz, Feriado, etc.",
      },
      suspended_by: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: "Nombre/firma de quien autorizó la suspensión.",
      },
      observations: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "WorkDayLog",
      tableName: "WorkDayLogs",
      timestamps: true,
      paranoid: true,
      underscored: true,
      indexes: [
        {
          unique: true,
          fields: ["project_id", "date"],
        },
      ],
    }
  );

  return WorkDayLog;
};
