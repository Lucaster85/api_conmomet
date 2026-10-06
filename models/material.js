"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class Material extends Model {
    static associate(models) {
      Material.belongsTo(models.MaterialUnit, { foreignKey: "material_unit_id", as: "materialUnit" });
      Material.hasMany(models.BudgetMaterialItem, { foreignKey: "material_id", as: "budgetMaterialItems" });
      Material.hasMany(models.MaterialCostHistory, { foreignKey: "material_id", as: "costHistory" });
      Material.hasMany(models.MaterialProviderPrice, { foreignKey: "material_id", as: "providerPrices" });
    }
  }
  Material.init({
    description: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    material_unit_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "MaterialUnits", key: "id" },
    },
    kg_per_meter: {
      type: DataTypes.DECIMAL(10, 3),
      allowNull: true,
      comment: "Kg por metro lineal (ejes, perfiles, etc.) — dato opcional",
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  }, {
    sequelize,
    modelName: "Material",
    tableName: "Materials",
    timestamps: true,
    paranoid: true,
    underscored: true,
  });
  return Material;
};
