"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class Oca extends Model {
    static associate(models) {
      Oca.belongsTo(models.Client, { foreignKey: "client_id", as: "client" });
      Oca.belongsTo(models.ClientSupervisor, { foreignKey: "supervisor_id", as: "supervisor" });
      Oca.belongsTo(models.Project, { foreignKey: "project_id", as: "project" });
      Oca.belongsTo(models.Oca, { foreignKey: "source_oca_id", as: "sourceOca" });
      Oca.hasMany(models.Oca, { foreignKey: "source_oca_id", as: "correctedOcas" });
      Oca.belongsTo(models.User, { foreignKey: "approved_by", as: "approvedByUser" });
      Oca.belongsTo(models.User, { foreignKey: "rejected_by", as: "rejectedByUser" });
      Oca.hasMany(models.OcaLine, { foreignKey: "oca_id", as: "lines" });
      Oca.hasMany(models.OcaStatusLog, { foreignKey: "oca_id", as: "logs" });
      Oca.hasMany(models.TimeEntry, { foreignKey: "oca_id", as: "timeEntries" });
    }
  }
  Oca.init(
    {
      number: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true,
      },
      type: {
        type: DataTypes.ENUM("man_hours", "crane_hours"),
        allowNull: false,
      },
      date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      client_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Clients", key: "id" },
      },
      supervisor_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "ClientSupervisors", key: "id" },
      },
      project_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Projects", key: "id" },
      },
      status: {
        type: DataTypes.ENUM("pendiente", "presentado", "aprobado", "rechazado", "anulado"),
        defaultValue: "pendiente",
        allowNull: false,
      },
      source_oca_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Ocas", key: "id" },
      },
      approved_img_url: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      approved_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      approved_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
      },
      rejected_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      rejected_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
      },
      rejection_reason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "Oca",
      tableName: "Ocas",
      timestamps: true,
      paranoid: true,
      underscored: true,
    }
  );
  return Oca;
};
