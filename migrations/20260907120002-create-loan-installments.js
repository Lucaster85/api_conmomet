"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("LoanInstallments", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      loan_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Loans", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      installment_number: { type: DataTypes.INTEGER, allowNull: false },
      due_month: { type: DataTypes.INTEGER, allowNull: false },
      due_year: { type: DataTypes.INTEGER, allowNull: false },
      due_period_type: { type: DataTypes.ENUM("first_half", "second_half"), allowNull: false },
      principal_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
      interest_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      total_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
      remaining_principal_after: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
      status: {
        type: DataTypes.ENUM("scheduled", "deducted", "prepaid", "cancelled"),
        allowNull: false,
        defaultValue: "scheduled",
      },
      payroll_entry_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "PayrollEntries", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      loan_payment_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "LoanPayments", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      deducted_at: { type: DataTypes.DATEONLY, allowNull: true },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("LoanInstallments", ["loan_id", "installment_number"], {
      unique: true,
      name: "loan_installments_loan_id_installment_number_unique",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("LoanInstallments");
  },
};
