"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class MaterialCostHistory extends Model {
    static associate(models) {
      MaterialCostHistory.belongsTo(models.Material, { foreignKey: "material_id", as: "material" });
      MaterialCostHistory.belongsTo(models.User, { foreignKey: "changed_by", as: "changedBy" });
    }
  }
  MaterialCostHistory.init({
    material_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Materials", key: "id" },
    },
    cost: {
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
    modelName: "MaterialCostHistory",
    tableName: "MaterialCostHistories",
    timestamps: true,
    underscored: true,
    // Sin paranoid: es un log de auditoría append-only, no tiene sentido "borrar" una
    // entrada histórica — mismo criterio que EmployeeRate.
  });
  return MaterialCostHistory;
};
