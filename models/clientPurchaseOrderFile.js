"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

// Archivo de una OC del cliente (patrón de QuoteRequestFile).
module.exports = () => {
  class ClientPurchaseOrderFile extends Model {
    static associate(models) {
      ClientPurchaseOrderFile.belongsTo(models.ClientPurchaseOrder, { foreignKey: "purchase_order_id", as: "purchaseOrder" });
      ClientPurchaseOrderFile.belongsTo(models.User, { foreignKey: "uploaded_by", as: "uploader" });
    }
  }
  ClientPurchaseOrderFile.init({
    purchase_order_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "ClientPurchaseOrders", key: "id" } },
    file_url: { type: DataTypes.STRING(500), allowNull: false },
    file_key: { type: DataTypes.STRING(500), allowNull: true },
    file_name: { type: DataTypes.STRING(255), allowNull: true },
    mime_type: { type: DataTypes.STRING(120), allowNull: true },
    size_bytes: { type: DataTypes.INTEGER, allowNull: true },
    uploaded_by: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Users", key: "id" } },
  }, {
    sequelize, modelName: "ClientPurchaseOrderFile", tableName: "ClientPurchaseOrderFiles", timestamps: true, paranoid: true, underscored: true,
  });
  return ClientPurchaseOrderFile;
};
