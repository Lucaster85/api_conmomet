"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

// Orden de compra del cliente (PLAN_ARCA.md §3.1, FLOWS.md §69). No confundir con `Oca` (remito de horas) ni con `Budget.work_order_number`.
module.exports = () => {
  class ClientPurchaseOrder extends Model {
    static associate(models) {
      ClientPurchaseOrder.belongsTo(models.Budget, { foreignKey: "budget_id", as: "budget" });
      ClientPurchaseOrder.belongsTo(models.User, { foreignKey: "created_by", as: "createdBy" });
      ClientPurchaseOrder.belongsTo(models.ClientPurchaseOrder, { foreignKey: "replaces_id", as: "replaces" });
      ClientPurchaseOrder.hasMany(models.ClientPurchaseOrderItem, { foreignKey: "purchase_order_id", as: "items" });
      ClientPurchaseOrder.hasMany(models.ClientPurchaseOrderFile, { foreignKey: "purchase_order_id", as: "files" });
      ClientPurchaseOrder.hasMany(models.SuretyBond, { foreignKey: "purchase_order_id", as: "suretyBonds" });
    }
  }
  ClientPurchaseOrder.init({
    budget_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Budgets", key: "id" } },
    number: { type: DataTypes.STRING(60), allowNull: false },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    concept: { type: DataTypes.ENUM("materials", "labor", "all"), allowNull: false, defaultValue: "all" },
    currency: { type: DataTypes.ENUM("ARS", "USD"), allowNull: false },
    amount: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    payment_terms: { type: DataTypes.TEXT, allowNull: true },
    allows_adjustment: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    adjustment_type: { type: DataTypes.ENUM("ipc_indec", "uocra", "other"), allowNull: false, defaultValue: "ipc_indec" },
    adjustment_notes: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.ENUM("active", "rejected", "replaced"), allowNull: false, defaultValue: "active" },
    rejection_reason: { type: DataTypes.TEXT, allowNull: true },
    replaces_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: "ClientPurchaseOrders", key: "id" } },
    created_by: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Users", key: "id" } },
  }, {
    sequelize, modelName: "ClientPurchaseOrder", tableName: "ClientPurchaseOrders", timestamps: true, paranoid: true, underscored: true,
  });
  return ClientPurchaseOrder;
};
