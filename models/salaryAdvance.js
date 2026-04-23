"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class SalaryAdvance extends Model {
    static associate(models) {
      SalaryAdvance.belongsTo(models.Employee, { foreignKey: "employee_id", as: "employee" });
      SalaryAdvance.belongsTo(models.PayPeriod, { foreignKey: "pay_period_id", as: "payPeriod" });
      SalaryAdvance.belongsTo(models.User, { foreignKey: "approved_by", as: "approvedBy" });
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
    approved_by: {
      type: DataTypes.INTEGER,
      references: { model: "Users", key: "id" },
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
