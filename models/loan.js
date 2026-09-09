"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class Loan extends Model {
    static associate(models) {
      Loan.belongsTo(models.Employee, { foreignKey: "employee_id", as: "employee" });
      Loan.belongsTo(models.User, { foreignKey: "approved_by", as: "approvedBy" });
      Loan.belongsTo(models.User, { foreignKey: "created_by", as: "createdBy" });
      Loan.belongsTo(models.User, { foreignKey: "updated_by", as: "updatedBy" });
      Loan.belongsTo(models.User, { foreignKey: "requested_by", as: "requestedBy" });
      Loan.belongsTo(models.User, { foreignKey: "paid_by", as: "paidBy" });
      Loan.hasMany(models.LoanPayment, { foreignKey: "loan_id", as: "payments" });
      Loan.hasMany(models.LoanInterestApplication, { foreignKey: "loan_id", as: "interestApplications" });
      Loan.hasMany(models.LoanInstallment, { foreignKey: "loan_id", as: "installments" });
    }
  }
  Loan.init({
    employee_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Employees", key: "id" },
    },
    currency: {
      type: DataTypes.ENUM("USD", "ARS"),
      allowNull: false,
      defaultValue: "USD",
    },
    amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    requested_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
    },
    interest_rate_percent: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
    },
    // Rediseño de cuota fija (amortización francesa) — ver loanAmortizationService.js.
    // `interest_rate_percent` (arriba) queda exclusivo del botón "Aplicar interés" manual de
    // los préstamos `discretionary` viejos; nunca se mezcla con `monthly_interest_percent`.
    plan_type: {
      type: DataTypes.ENUM("discretionary", "fixed_installments"),
      allowNull: false,
      defaultValue: "discretionary",
    },
    num_installments: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    requested_num_installments: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    monthly_interest_percent: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
    },
    installment_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
    },
    due_period_type: {
      type: DataTypes.ENUM("first_half", "second_half"),
      allowNull: true,
    },
    exchange_rate_at_origin: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
    },
    amount_ars_at_origin: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
    },
    remaining_balance: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    payment_method: {
      type: DataTypes.ENUM("efectivo", "transferencia"),
      allowNull: true,
    },
    start_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("pending", "approved", "active", "rejected", "completed", "cancelled"),
      allowNull: false,
      defaultValue: "active",
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    rejection_reason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    requested_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Users", key: "id" },
    },
    approved_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Users", key: "id" },
    },
    approved_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    paid_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
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
    modelName: "Loan",
    tableName: "Loans",
    timestamps: true,
    underscored: true,
  });
  return Loan;
};
