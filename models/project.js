"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class Project extends Model {
    static associate(models) {
      Project.belongsTo(models.Client, { foreignKey: "client_id", as: "client" });
      Project.belongsTo(models.Plant, { foreignKey: "plant_id", as: "plant" });
      Project.hasMany(models.TimeEntry, { foreignKey: "project_id", as: "timeEntries" });
      Project.belongsToMany(models.ClientSupervisor, {
        through: "ProjectSupervisors",
        foreignKey: "project_id",
        otherKey: "supervisor_id",
        as: "supervisors",
      });
      Project.hasMany(models.Oca, { foreignKey: "project_id", as: "ocas" });
      Project.hasMany(models.OcaLine, { foreignKey: "project_id", as: "ocaLines" });
      // Jerarquía padre/hijo (subproyectos/adicionales) — máximo 2 niveles, ver services/projectFactory.js
      Project.belongsTo(models.Project, { foreignKey: "parent_id", as: "parent" });
      Project.hasMany(models.Project, { foreignKey: "parent_id", as: "subprojects" });
      Project.hasOne(models.Budget, { foreignKey: "project_id", as: "budget" });
      Project.hasMany(models.Budget, { foreignKey: "parent_project_id", as: "additionalBudgets" });
      Project.hasMany(models.WorkDayLog, { foreignKey: "project_id", as: "workDayLogs" });
    }
  }
  Project.init({
    name: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    code: {
      type: DataTypes.STRING(30),
      unique: true,
    },
    client_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Clients", key: "id" },
    },
    parent_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Projects", key: "id" },
      comment: "Proyecto padre si este es un subproyecto/adicional. No se setea desde projectController.create — solo vía services/projectFactory.js al aprobar un presupuesto adicional.",
    },
    plant_id: {
      type: DataTypes.INTEGER,
      references: { model: "Plants", key: "id" },
    },
    description: {
      type: DataTypes.TEXT,
    },
    budgeted_hours: {
      type: DataTypes.DECIMAL(8, 2),
      defaultValue: 0,
    },
    status: {
      type: DataTypes.ENUM("draft", "active", "paused", "completed", "cancelled"),
      defaultValue: "active",
    },
    start_date: {
      type: DataTypes.DATEONLY,
    },
    end_date: {
      type: DataTypes.DATEONLY,
    },
    notes: {
      type: DataTypes.TEXT,
    },
  }, {
    sequelize,
    modelName: "Project",
    tableName: "Projects",
    timestamps: true,
    paranoid: true,
    underscored: true,
  });
  return Project;
};
