"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class SalaryAdvance extends Model {
    static associate(models) {
      SalaryAdvance.belongsTo(models.Employee, { foreignKey: "employee_id", as: "employee" });
      SalaryAdvance.belongsTo(models.PayPeriod, { foreignKey: "pay_period_id", as: "payPeriod" });
      SalaryAdvance.belongsTo(models.User, { foreignKey: "approved_by", as: "approvedBy" });
      SalaryAdvance.belongsTo(models.User, { foreignKey: "requested_by", as: "requestedBy" });
      SalaryAdvance.belongsTo(models.User, { foreignKey: "paid_by", as: "paidBy" });
    }
  }
  SalaryAdvance.init({
    employee_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Employees", key: "id" },
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    payment_method: {
      type: DataTypes.ENUM("efectivo", "transferencia"),
      allowNull: true,
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    pay_period_id: {
      type: DataTypes.INTEGER,
      references: { model: "PayPeriods", key: "id" },
    },
    notes: {
      type: DataTypes.TEXT,
    },
    status: {
      type: DataTypes.ENUM("pending", "approved", "rejected"),
      allowNull: false,
      defaultValue: "pending",
    },
    requested_amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    requested_by: {
      type: DataTypes.INTEGER,
      references: { model: "Users", key: "id" },
    },
    approved_by: {
      type: DataTypes.INTEGER,
      references: { model: "Users", key: "id" },
    },
    approved_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    paid_by: {
      type: DataTypes.INTEGER,
      references: { model: "Users", key: "id" },
    },
    paid_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    payment_proof_url: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    payment_proof_key: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    payment_proof_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
  }, {
    sequelize,
    modelName: "SalaryAdvance",
    tableName: "SalaryAdvances",
    timestamps: true,
    paranoid: true,
    underscored: true,
  });
  return SalaryAdvance;
};
