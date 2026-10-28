"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class LoanChangeAlert extends Model {
    static associate(models) {
      LoanChangeAlert.belongsTo(models.Loan, { foreignKey: "loan_id", as: "loan" });
      LoanChangeAlert.belongsTo(models.Employee, { foreignKey: "employee_id", as: "employee" });
      LoanChangeAlert.belongsTo(models.User, { foreignKey: "created_by", as: "createdBy" });
    }
  }
  LoanChangeAlert.init({
    loan_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Loans", key: "id" },
    },
    employee_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Employees", key: "id" },
    },
    action: {
      type: DataTypes.ENUM("rescheduled", "cancelled"),
      allowNull: false,
    },
    justification: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    previous_terms: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    new_terms: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Users", key: "id" },
    },
  }, {
    sequelize,
    modelName: "LoanChangeAlert",
    tableName: "LoanChangeAlerts",
    timestamps: true,
    underscored: true,
  });
  return LoanChangeAlert;
};
