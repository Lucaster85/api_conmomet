"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class ClientItemRate extends Model {
    static associate(models) {
      ClientItemRate.belongsTo(models.Client, { foreignKey: "client_id", as: "client" });
      ClientItemRate.belongsTo(models.BudgetItemType, { foreignKey: "budget_item_type_id", as: "itemType" });
      ClientItemRate.belongsTo(models.User, { foreignKey: "updated_by", as: "updatedBy" });
    }
  }
  ClientItemRate.init({
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
    current_rate: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
    },
    currency: {
      type: DataTypes.ENUM("ARS", "USD"),
      allowNull: false,
    },
    updated_by: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Users", key: "id" },
    },
  }, {
    sequelize,
    modelName: "ClientItemRate",
    tableName: "ClientItemRates",
    timestamps: true,
    underscored: true,
    // Sin paranoid: valor "actual" por (client_id, budget_item_type_id), igual que
    // Material.current_cost — el histórico vive en ClientItemRateHistory.
  });
  return ClientItemRate;
};
