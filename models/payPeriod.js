"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class PayPeriod extends Model {
    static associate(models) {
      PayPeriod.hasMany(models.PayrollEntry, { foreignKey: "pay_period_id", as: "payrollEntries" });
      PayPeriod.hasMany(models.SalaryAdvance, { foreignKey: "pay_period_id", as: "salaryAdvances" });
      PayPeriod.belongsTo(models.User, { foreignKey: "closed_by", as: "closedBy" });
    }
  }
  PayPeriod.init({
    start_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    end_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    type: {
      type: DataTypes.ENUM("first_half", "second_half"),
      allowNull: false,
    },
    month: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    year: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("open", "closed", "paid"),
      defaultValue: "open",
    },
    closed_by: {
      type: DataTypes.INTEGER,
      references: { model: "Users", key: "id" },
    },
    closed_at: {
      type: DataTypes.DATE,
    },
  }, {
    sequelize,
    modelName: "PayPeriod",
    tableName: "PayPeriods",
    timestamps: true,
    paranoid: true,
    underscored: true,
  });
  return PayPeriod;
};
