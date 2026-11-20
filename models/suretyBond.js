"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

// Seguro de caución (PLAN_ARCA.md §3.5, FLOWS.md §69). El vencimiento es opcional; solo las pólizas con vencimiento y sin devolver entran al barrido de avisos.
module.exports = () => {
  class SuretyBond extends Model {
    static associate(models) {
      SuretyBond.belongsTo(models.Budget, { foreignKey: "budget_id", as: "budget" });
      SuretyBond.belongsTo(models.ClientPurchaseOrder, { foreignKey: "purchase_order_id", as: "purchaseOrder" });
      SuretyBond.belongsTo(models.User, { foreignKey: "created_by", as: "createdBy" });
    }
  }
  SuretyBond.init({
    budget_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Budgets", key: "id" } },
    purchase_order_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: "ClientPurchaseOrders", key: "id" } },
    insurer: { type: DataTypes.STRING(150), allowNull: false },
    policy_number: { type: DataTypes.STRING(80), allowNull: false },
    amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    currency: { type: DataTypes.ENUM("ARS", "USD"), allowNull: false },
    issue_date: { type: DataTypes.DATEONLY, allowNull: true },
    purpose: { type: DataTypes.ENUM("advance_payment", "other"), allowNull: false, defaultValue: "advance_payment" },
    expiration_date: { type: DataTypes.DATEONLY, allowNull: true },
    notify_days_before: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 30 },
    released_at: { type: DataTypes.DATEONLY, allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
    file_url: { type: DataTypes.STRING(500), allowNull: true },
    file_key: { type: DataTypes.STRING(500), allowNull: true },
    file_name: { type: DataTypes.STRING(255), allowNull: true },
    mime_type: { type: DataTypes.STRING(120), allowNull: true },
    size_bytes: { type: DataTypes.INTEGER, allowNull: true },
    created_by: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Users", key: "id" } },
  }, {
    sequelize, modelName: "SuretyBond", tableName: "SuretyBonds", timestamps: true, paranoid: true, underscored: true,
  });
  return SuretyBond;
};
