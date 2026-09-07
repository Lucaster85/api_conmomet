"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

// El "plan" de cuotas de un préstamo `fixed_installments`: se genera entero, una sola vez, al
// otorgar/aprobar el préstamo (ver loanAmortizationService.js). Es distinto de LoanPayment, que
// es el libro mayor de lo efectivamente cobrado — cada cuota que se cobra (automático en
// liquidación o cancelación anticipada) también crea su fila normal en LoanPayment.
module.exports = () => {
  class LoanInstallment extends Model {
    static associate(models) {
      LoanInstallment.belongsTo(models.Loan, { foreignKey: "loan_id", as: "loan" });
      LoanInstallment.belongsTo(models.PayrollEntry, { foreignKey: "payroll_entry_id", as: "payrollEntry" });
      LoanInstallment.belongsTo(models.LoanPayment, { foreignKey: "loan_payment_id", as: "payment" });
    }
  }
  LoanInstallment.init({
    loan_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Loans", key: "id" },
    },
    installment_number: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    due_month: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    due_year: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    due_period_type: {
      type: DataTypes.ENUM("first_half", "second_half"),
      allowNull: false,
    },
    principal_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    interest_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 0,
    },
    total_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    remaining_principal_after: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("scheduled", "deducted", "prepaid", "cancelled"),
      allowNull: false,
      defaultValue: "scheduled",
    },
    payroll_entry_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "PayrollEntries", key: "id" },
    },
    loan_payment_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "LoanPayments", key: "id" },
    },
    deducted_at: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
  }, {
    sequelize,
    modelName: "LoanInstallment",
    tableName: "LoanInstallments",
    timestamps: true,
    underscored: true,
  });
  return LoanInstallment;
};
