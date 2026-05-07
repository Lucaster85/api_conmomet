"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class PayrollEntry extends Model {
    static associate(models) {
      PayrollEntry.belongsTo(models.PayPeriod, { foreignKey: "pay_period_id", as: "payPeriod" });
      PayrollEntry.belongsTo(models.Employee, { foreignKey: "employee_id", as: "employee" });
      PayrollEntry.hasMany(models.PayrollLine, { foreignKey: "payroll_entry_id", as: "lines" });
      PayrollEntry.hasMany(models.PayrollAdjustment, { foreignKey: "payroll_entry_id", as: "adjustments" });
      PayrollEntry.hasMany(models.LoanPayment, { foreignKey: "payroll_entry_id", as: "loanPayments" });
    }
  }
  PayrollEntry.init({
    pay_period_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "PayPeriods", key: "id" },
    },
    employee_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Employees", key: "id" },
    },
    total_regular_hours: { type: DataTypes.DECIMAL(6, 2) },
    total_overtime_50_hours: { type: DataTypes.DECIMAL(6, 2) },
    total_overtime_100_hours: { type: DataTypes.DECIMAL(6, 2) },
    regular_amount: { type: DataTypes.DECIMAL(10, 2) },
    overtime_50_amount: { type: DataTypes.DECIMAL(10, 2) },
    overtime_100_amount: { type: DataTypes.DECIMAL(10, 2) },
    gross_amount: { type: DataTypes.DECIMAL(10, 2) },
    advances_deducted: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
    net_amount: { type: DataTypes.DECIMAL(10, 2) },
    late_count: { type: DataTypes.INTEGER, defaultValue: 0 },
    absent_count: { type: DataTypes.INTEGER, defaultValue: 0 },
    status: {
      type: DataTypes.ENUM("draft", "confirmed", "paid"),
      defaultValue: "draft",
    },
    paid_at: { type: DataTypes.DATE },
    notes: { type: DataTypes.TEXT },
  }, {
    sequelize,
    modelName: "PayrollEntry",
    tableName: "PayrollEntries",
    timestamps: true,
    paranoid: true,
    underscored: true,
  });
  return PayrollEntry;
};
