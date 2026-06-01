"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class ProjectSupervisor extends Model {
    static associate(models) {
      // Junction model associations
      ProjectSupervisor.belongsTo(models.Project, { foreignKey: "project_id", as: "project" });
      ProjectSupervisor.belongsTo(models.ClientSupervisor, { foreignKey: "supervisor_id", as: "supervisor" });
    }
  }
  ProjectSupervisor.init(
    {
      project_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        references: { model: "Projects", key: "id" },
      },
      supervisor_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        references: { model: "ClientSupervisors", key: "id" },
      },
    },
    {
      sequelize,
      modelName: "ProjectSupervisor",
      tableName: "ProjectSupervisors",
      timestamps: true,
      underscored: true,
    }
  );
  return ProjectSupervisor;
};
