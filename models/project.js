"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class Project extends Model {
    static associate(models) {
      Project.belongsTo(models.Client, { foreignKey: "client_id", as: "client" });
      Project.belongsTo(models.Plant, { foreignKey: "plant_id", as: "plant" });
      Project.hasMany(models.TimeEntry, { foreignKey: "project_id", as: "timeEntries" });
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
