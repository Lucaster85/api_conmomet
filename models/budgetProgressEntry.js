"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

// Avance real de obra de un presupuesto (PLAN_ARCA.md §3.4, FLOWS.md §72): medición paralela a la de horas. `percent` es ACUMULADO.
module.exports = () => {
  class BudgetProgressEntry extends Model {
    static associate(models) {
      BudgetProgressEntry.belongsTo(models.Budget, { foreignKey: "budget_id", as: "budget" });
      BudgetProgressEntry.belongsTo(models.User, { foreignKey: "created_by", as: "createdBy" });
      BudgetProgressEntry.hasMany(models.BudgetProgressEntryFile, { foreignKey: "progress_entry_id", as: "files" });
    }
  }
  BudgetProgressEntry.init({
    budget_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Budgets", key: "id" } },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    percent: { type: DataTypes.DECIMAL(5, 2), allowNull: false },
    source: { type: DataTypes.ENUM("certificate", "manual"), allowNull: false, defaultValue: "manual" },
    certificate_number: { type: DataTypes.STRING(60), allowNull: true },
    status: { type: DataTypes.ENUM("presented", "approved", "rejected"), allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
    created_by: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Users", key: "id" } },
  }, {
    sequelize, modelName: "BudgetProgressEntry", tableName: "BudgetProgressEntries", timestamps: true, paranoid: true, underscored: true,
  });
  return BudgetProgressEntry;
};
