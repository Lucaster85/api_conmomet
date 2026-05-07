"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class EmployerCostCategory extends Model {
    static associate(models) {
      EmployerCostCategory.hasMany(models.EmployerCost, { foreignKey: "category_id", as: "employerCosts" });
    }
  }
  EmployerCostCategory.init({
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    code: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
    },
    sort_order: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  }, {
    sequelize,
    modelName: "EmployerCostCategory",
    tableName: "EmployerCostCategories",
    timestamps: true,
    underscored: true,
  });
  return EmployerCostCategory;
};
