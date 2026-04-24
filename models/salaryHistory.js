"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class SalaryHistory extends Model {
    static associate(models) {
      SalaryHistory.belongsTo(models.Employee, { foreignKey: "employee_id", as: "employee" });
      SalaryHistory.belongsTo(models.User, { foreignKey: "changed_by", as: "changedBy" });
    }
  }
  SalaryHistory.init({
    employee_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Employees", key: "id" },
    },
    field_changed: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    previous_value: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    new_value: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    effective_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    changed_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Users", key: "id" },
    },
    notes: {
      type: DataTypes.TEXT,
    },
  }, {
    sequelize,
    modelName: "SalaryHistory",
    tableName: "SalaryHistories",
    timestamps: true,
    underscored: true,
  });
  return SalaryHistory;
};
