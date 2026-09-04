"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class ClientItemRateHistory extends Model {
    static associate(models) {
      ClientItemRateHistory.belongsTo(models.Client, { foreignKey: "client_id", as: "client" });
      ClientItemRateHistory.belongsTo(models.BudgetItemType, { foreignKey: "budget_item_type_id", as: "itemType" });
      ClientItemRateHistory.belongsTo(models.User, { foreignKey: "changed_by", as: "changedBy" });
    }
  }
  ClientItemRateHistory.init({
    client_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Clients", key: "id" },
    },
    budget_item_type_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "BudgetItemTypes", key: "id" },
    },
    rate: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
    },
    currency: {
      type: DataTypes.ENUM("ARS", "USD"),
      allowNull: false,
    },
    changed_by: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Users", key: "id" },
    },
  }, {
    sequelize,
    modelName: "ClientItemRateHistory",
    tableName: "ClientItemRateHistories",
    timestamps: true,
    underscored: true,
    // Sin paranoid: es un log de auditoría append-only — mismo criterio que MaterialCostHistory.
  });
  return ClientItemRateHistory;
};
