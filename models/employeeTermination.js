"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class EmployeeTermination extends Model {
    static associate(models) {
      EmployeeTermination.belongsTo(models.Employee, { foreignKey: "employee_id", as: "employee" });
      EmployeeTermination.belongsTo(models.User, { foreignKey: "created_by", as: "createdBy" });
      EmployeeTermination.belongsTo(models.User, { foreignKey: "confirmed_by", as: "confirmedBy" });
      EmployeeTermination.belongsTo(models.User, { foreignKey: "cancelled_by", as: "cancelledBy" });
      EmployeeTermination.belongsTo(models.PayrollEntry, { foreignKey: "final_payroll_entry_id", as: "finalPayrollEntry" });
      EmployeeTermination.hasMany(models.EntityDocument, {
        foreignKey: "employee_termination_id",
        as: "documents",
      });
    }
  }
  EmployeeTermination.init(
    {
      employee_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Employees", key: "id" },
      },
      type: {
        type: DataTypes.ENUM("resignation", "dismissal_with_cause", "dismissal_without_cause", "mutual_agreement"),
        allowNull: false,
      },
      notice_date: { type: DataTypes.DATEONLY, allowNull: true },
      termination_date: { type: DataTypes.DATEONLY, allowNull: false },
      notice_given: {
        type: DataTypes.ENUM("none", "full", "partial"),
        allowNull: false,
        defaultValue: "none",
      },
      notice_start_date: { type: DataTypes.DATEONLY, allowNull: true },
      notice_end_date: { type: DataTypes.DATEONLY, allowNull: true },
      cause_description: { type: DataTypes.TEXT, allowNull: true },
      employee_notice_omitted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      cct_cap_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
      status: {
        type: DataTypes.ENUM("draft", "confirmed", "settled", "cancelled"),
        allowNull: false,
        defaultValue: "draft",
      },
      final_payroll_entry_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "PayrollEntries", key: "id" },
      },
      art80_delivered_at: { type: DataTypes.DATEONLY, allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
      created_by: { type: DataTypes.INTEGER, allowNull: true, references: { model: "Users", key: "id" } },
      confirmed_at: { type: DataTypes.DATE, allowNull: true },
      confirmed_by: { type: DataTypes.INTEGER, allowNull: true, references: { model: "Users", key: "id" } },
      cancelled_at: { type: DataTypes.DATE, allowNull: true },
      cancelled_by: { type: DataTypes.INTEGER, allowNull: true, references: { model: "Users", key: "id" } },
      cancellation_reason: { type: DataTypes.TEXT, allowNull: true },
      // Deuda pendiente del empleado, resuelta de una sola vez (PLAN_EGRESOS.md §6.2).
      debt_resolution: { type: DataTypes.ENUM("paid", "condoned"), allowNull: true },
      debt_resolved_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
      debt_resolved_at: { type: DataTypes.DATE, allowNull: true },
      debt_resolved_by: { type: DataTypes.INTEGER, allowNull: true, references: { model: "Users", key: "id" } },
      debt_payment_method: { type: DataTypes.ENUM("efectivo", "transferencia"), allowNull: true },
      debt_resolution_notes: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      sequelize,
      modelName: "EmployeeTermination",
      tableName: "EmployeeTerminations",
      timestamps: true,
      underscored: true,
    }
  );
  return EmployeeTermination;
};
