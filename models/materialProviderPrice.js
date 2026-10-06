"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class MaterialProviderPrice extends Model {
    static associate(models) {
      MaterialProviderPrice.belongsTo(models.Material, { foreignKey: "material_id", as: "material" });
      MaterialProviderPrice.belongsTo(models.Provider, { foreignKey: "provider_id", as: "provider" });
    }
  }
  MaterialProviderPrice.init({
    material_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Materials", key: "id" },
    },
    provider_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Providers", key: "id" },
    },
    cost: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      comment: "Nulo = el proveedor tiene el material pero todavía sin precio",
    },
    currency: {
      type: DataTypes.ENUM("ARS", "USD"),
      allowNull: true,
    },
  }, {
    sequelize,
    modelName: "MaterialProviderPrice",
    tableName: "MaterialProviderPrices",
    timestamps: true,
    underscored: true,
    // Sin paranoid: el vínculo se borra de verdad; el historial vive en MaterialCostHistory.
  });
  return MaterialProviderPrice;
};
