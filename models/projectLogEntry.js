"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class ProjectLogEntry extends Model {
    static associate(models) {
      ProjectLogEntry.belongsTo(models.Project, { foreignKey: "project_id", as: "project" });
      ProjectLogEntry.belongsTo(models.User, { foreignKey: "user_id", as: "author" });
      ProjectLogEntry.hasMany(models.ProjectLogEntryFile, { foreignKey: "entry_id", as: "files" });
    }
  }
  ProjectLogEntry.init({
    project_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Projects", key: "id" },
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Users", key: "id" },
    },
    note: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  }, {
    sequelize,
    modelName: "ProjectLogEntry",
    tableName: "ProjectLogEntries",
    timestamps: true,
    underscored: true,
    // Sin paranoid: seguimiento de solo agregar — no se edita ni se borra (mismo criterio que los
    // logs de estado, ej. QuoteRequestStatusLog).
  });
  return ProjectLogEntry;
};
