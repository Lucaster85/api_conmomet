"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

// Posición de una OC del cliente (opcional). Se reemplazan todas juntas al editar la OC.
module.exports = () => {
  class ClientPurchaseOrderItem extends Model {
    static associate(models) {
      ClientPurchaseOrderItem.belongsTo(models.ClientPurchaseOrder, { foreignKey: "purchase_order_id", as: "purchaseOrder" });
    }
  }
  ClientPurchaseOrderItem.init({
    purchase_order_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "ClientPurchaseOrders", key: "id" } },
    position: { type: DataTypes.STRING(20), allowNull: true },
    description: { type: DataTypes.STRING(255), allowNull: false },
    amount: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
  }, {
    sequelize, modelName: "ClientPurchaseOrderItem", tableName: "ClientPurchaseOrderItems", timestamps: true, underscored: true,
  });
  return ClientPurchaseOrderItem;
};
