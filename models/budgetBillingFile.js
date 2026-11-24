"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

// Documento extra del detalle de facturación de un presupuesto (PLAN_ARCA.md §3.6, FLOWS.md §69).
module.exports = () => {
  class BudgetBillingFile extends Model {
    static associate(models) {
      BudgetBillingFile.belongsTo(models.Budget, { foreignKey: "budget_id", as: "budget" });
      BudgetBillingFile.belongsTo(models.User, { foreignKey: "uploaded_by", as: "uploader" });
    }
  }
  BudgetBillingFile.init({
    budget_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Budgets", key: "id" } },
    description: { type: DataTypes.STRING(255), allowNull: true },
    file_url: { type: DataTypes.STRING(500), allowNull: false },
    file_key: { type: DataTypes.STRING(500), allowNull: true },
    file_name: { type: DataTypes.STRING(255), allowNull: true },
    mime_type: { type: DataTypes.STRING(120), allowNull: true },
    size_bytes: { type: DataTypes.INTEGER, allowNull: true },
    uploaded_by: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Users", key: "id" } },
  }, {
    sequelize, modelName: "BudgetBillingFile", tableName: "BudgetBillingFiles", timestamps: true, paranoid: true, underscored: true,
  });
  return BudgetBillingFile;
};
