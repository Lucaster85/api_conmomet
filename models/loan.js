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
      Loan.hasMany(models.LoanPayment, { foreignKey: "loan_id", as: "payments" });
    }
  }
  Loan.init({
    employee_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Employees", key: "id" },
    },
    amount_usd: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    exchange_rate_at_origin: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    amount_ars_at_origin: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
    },
    remaining_balance_usd: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    start_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("active", "completed", "cancelled"),
      allowNull: false,
      defaultValue: "active",
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    approved_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Users", key: "id" },
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
