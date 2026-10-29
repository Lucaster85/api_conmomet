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
    usd_exchange_rate: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
    },
    usd_exchange_rate_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: "Fecha de la regla (end_date + 1) a la que corresponde la cotización.",
    },
    usd_exchange_rate_source: {
      type: DataTypes.ENUM("api", "manual"),
      allowNull: true,
    },
    usd_exchange_rate_locked_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "NULL = provisoria. Se setea al cerrar la quincena: desde ahí es definitiva.",
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
