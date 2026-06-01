"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class OcaLine extends Model {
    static associate(models) {
      OcaLine.belongsTo(models.Oca, { foreignKey: "oca_id", as: "oca" });
      OcaLine.belongsTo(models.TimeEntry, { foreignKey: "time_entry_id", as: "timeEntry" });
      OcaLine.belongsTo(models.Employee, { foreignKey: "employee_id", as: "employee" });
      OcaLine.belongsTo(models.Project, { foreignKey: "project_id", as: "project" });
      OcaLine.belongsTo(models.Vehicle, { foreignKey: "vehicle_id", as: "vehicle" });
    }
  }
  OcaLine.init(
    {
      oca_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Ocas", key: "id" },
      },
      time_entry_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "TimeEntries", key: "id" },
      },
      employee_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Employees", key: "id" },
      },
      project_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Projects", key: "id" },
      },
      vehicle_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Vehicles", key: "id" },
      },
      date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      check_in: {
        type: DataTypes.TIME,
        allowNull: true,
      },
      check_out: {
        type: DataTypes.TIME,
        allowNull: true,
      },
      regular_hours: {
        type: DataTypes.DECIMAL(6, 2),
        allowNull: false,
      },
      overtime_50_hours: {
        type: DataTypes.DECIMAL(4, 2),
        defaultValue: 0,
        allowNull: false,
      },
      overtime_100_hours: {
        type: DataTypes.DECIMAL(4, 2),
        defaultValue: 0,
        allowNull: false,
      },
      type: {
        type: DataTypes.ENUM("man_hours", "crane_hours"),
        allowNull: false,
      },
      task: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "OcaLine",
      tableName: "OcaLines",
      timestamps: true,
      paranoid: true,
      underscored: true,
    }
  );
  return OcaLine;
};
