"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class ProjectLogEntryFile extends Model {
    static associate(models) {
      ProjectLogEntryFile.belongsTo(models.ProjectLogEntry, { foreignKey: "entry_id", as: "entry" });
    }
  }
  ProjectLogEntryFile.init({
    entry_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "ProjectLogEntries", key: "id" },
    },
    file_url: { type: DataTypes.STRING(500), allowNull: false },
    file_key: { type: DataTypes.STRING(500) },
    file_name: { type: DataTypes.STRING(255) },
    mime_type: { type: DataTypes.STRING(120) },
    size_bytes: { type: DataTypes.INTEGER },
  }, {
    sequelize,
    modelName: "ProjectLogEntryFile",
    tableName: "ProjectLogEntryFiles",
    timestamps: true,
    underscored: true,
  });
  return ProjectLogEntryFile;
};
