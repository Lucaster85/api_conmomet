"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class EmployerCost extends Model {
    static associate(models) {
      EmployerCost.belongsTo(models.EmployerCostCategory, { foreignKey: "category_id", as: "category" });
      EmployerCost.belongsTo(models.User, { foreignKey: "created_by", as: "createdBy" });
      EmployerCost.belongsTo(models.User, { foreignKey: "updated_by", as: "updatedBy" });
    }
  }
  EmployerCost.init({
    category_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "EmployerCostCategories", key: "id" },
    },
    month: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    year: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    amount: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
    },
    file_url: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Users", key: "id" },
    },
    updated_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Users", key: "id" },
    },
  }, {
    sequelize,
    modelName: "EmployerCost",
    tableName: "EmployerCosts",
    timestamps: true,
    underscored: true,
  });
  return EmployerCost;
};
