"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class BudgetLaborLine extends Model {
    static associate(models) {
      BudgetLaborLine.belongsTo(models.Budget, { foreignKey: "budget_id", as: "budget" });
      BudgetLaborLine.belongsTo(models.BudgetItemType, { foreignKey: "budget_item_type_id", as: "itemType" });
    }
  }
  BudgetLaborLine.init({
    budget_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Budgets", key: "id" },
    },
    budget_item_type_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "BudgetItemTypes", key: "id" },
    },
    quantity: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    unit_price: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
    },
    currency: {
      type: DataTypes.ENUM("ARS", "USD"),
      allowNull: true,
      comment: "Si es null, usa la moneda del Budget",
    },
    estimated_total: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
    },
    notes: {
      type: DataTypes.TEXT,
    },
  }, {
    sequelize,
    modelName: "BudgetLaborLine",
    tableName: "BudgetLaborLines",
    timestamps: true,
    paranoid: true,
    underscored: true,
  });
  return BudgetLaborLine;
};
