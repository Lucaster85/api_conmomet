"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class TimeEntry extends Model {
    static associate(models) {
      TimeEntry.belongsTo(models.Employee, { foreignKey: "employee_id", as: "employee" });
      TimeEntry.belongsTo(models.Plant, { foreignKey: "plant_id", as: "plant" });
      TimeEntry.belongsTo(models.Project, { foreignKey: "project_id", as: "project" });
      TimeEntry.belongsTo(models.User, { foreignKey: "registered_by", as: "registeredBy" });
      TimeEntry.belongsTo(models.User, { foreignKey: "approved_by", as: "approvedBy" });
      TimeEntry.belongsTo(models.User, { foreignKey: "voided_by", as: "voidedBy" });
      TimeEntry.belongsTo(models.PayrollConcept, { foreignKey: "concept_id", as: "concept" });
      TimeEntry.belongsTo(models.ClientSupervisor, { foreignKey: "supervisor_id", as: "supervisor" });
      TimeEntry.belongsTo(models.Vehicle, { foreignKey: "vehicle_id", as: "vehicle" });
      TimeEntry.belongsTo(models.Oca, { foreignKey: "oca_id", as: "oca" });
      TimeEntry.hasOne(models.OcaLine, { foreignKey: "time_entry_id", as: "ocaLine" });
    }
  }
  TimeEntry.init({
    employee_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Employees", key: "id" },
    },
    project_id: {
      type: DataTypes.INTEGER,
      references: { model: "Projects", key: "id" },
    },
    plant_id: {
      type: DataTypes.INTEGER,
      references: { model: "Plants", key: "id" },
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    check_in: {
      type: DataTypes.TIME,
      allowNull: false,
    },
    check_out: {
      type: DataTypes.TIME,
      allowNull: false,
    },
    regular_hours: {
      type: DataTypes.DECIMAL(4, 2),
      allowNull: false,
    },
    overtime_50_hours: {
      type: DataTypes.DECIMAL(4, 2),
      defaultValue: 0,
    },
    overtime_100_hours: {
      type: DataTypes.DECIMAL(4, 2),
      defaultValue: 0,
    },
    is_late: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    notes: {
      type: DataTypes.TEXT,
    },
    registered_by: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Users", key: "id" },
    },
    approved_by: {
      type: DataTypes.INTEGER,
      references: { model: "Users", key: "id" },
    },
    approved_at: {
      type: DataTypes.DATE,
    },
    status: {
      type: DataTypes.ENUM("pending", "approved", "voided"),
      defaultValue: "pending",
    },
    voided_by: {
      type: DataTypes.INTEGER,
      references: { model: "Users", key: "id" },
    },
    voided_at: {
      type: DataTypes.DATE,
    },
    void_reason: {
      type: DataTypes.TEXT,
    },
    concept_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "PayrollConcepts", key: "id" },
    },
    is_plant_hours: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    },
    supervisor_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "ClientSupervisors", key: "id" },
    },
    vehicle_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Vehicles", key: "id" },
    },
    oca_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Ocas", key: "id" },
    },
  }, {
    sequelize,
    modelName: "TimeEntry",
    tableName: "TimeEntries",
    timestamps: true,
    paranoid: true,
    underscored: true,
  });
  return TimeEntry;
};
