"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class LoanPayment extends Model {
    static associate(models) {
      LoanPayment.belongsTo(models.Loan, { foreignKey: "loan_id", as: "loan" });
      LoanPayment.belongsTo(models.PayrollEntry, { foreignKey: "payroll_entry_id", as: "payrollEntry" });
      LoanPayment.belongsTo(models.User, { foreignKey: "created_by", as: "createdBy" });
      LoanPayment.belongsTo(models.User, { foreignKey: "updated_by", as: "updatedBy" });
    }
  }
  LoanPayment.init({
    loan_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Loans", key: "id" },
    },
    payroll_entry_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "PayrollEntries", key: "id" },
    },
    amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    exchange_rate: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
    },
    amount_ars: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Users", key: "id" },
    },
    updated_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Users", key: "id" },
    },
  }, {
    sequelize,
    modelName: "LoanPayment",
    tableName: "LoanPayments",
    timestamps: true,
    underscored: true,
  });
  return LoanPayment;
};
