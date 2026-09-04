"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class LoanInterestApplication extends Model {
    static associate(models) {
      LoanInterestApplication.belongsTo(models.Loan, { foreignKey: "loan_id", as: "loan" });
      LoanInterestApplication.belongsTo(models.User, { foreignKey: "applied_by", as: "appliedBy" });
    }
  }
  LoanInterestApplication.init({
    loan_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Loans", key: "id" },
    },
    applied_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Users", key: "id" },
    },
    applied_at: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    rate_percent_used: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: false,
    },
    capital_before: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    interest_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    capital_after: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  }, {
    sequelize,
    modelName: "LoanInterestApplication",
    tableName: "LoanInterestApplications",
    timestamps: true,
    underscored: true,
  });
  return LoanInterestApplication;
};
