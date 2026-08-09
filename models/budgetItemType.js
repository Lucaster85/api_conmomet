"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class BudgetItemType extends Model {
    static associate(models) {
      BudgetItemType.hasMany(models.BudgetLaborLine, { foreignKey: "budget_item_type_id", as: "laborLines" });
    }
  }
  BudgetItemType.init({
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    unit_type: {
      type: DataTypes.ENUM("hours", "units"),
      allowNull: false,
    },
    unit_label: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: "hs",
    },
    display_order: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  }, {
    sequelize,
    modelName: "BudgetItemType",
    tableName: "BudgetItemTypes",
    timestamps: true,
    paranoid: true,
    underscored: true,
  });
  return BudgetItemType;
};
