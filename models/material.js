"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class Material extends Model {
    static associate(models) {
      Material.belongsTo(models.MaterialUnit, { foreignKey: "material_unit_id", as: "materialUnit" });
      Material.hasMany(models.BudgetMaterialItem, { foreignKey: "material_id", as: "budgetMaterialItems" });
      Material.hasMany(models.MaterialCostHistory, { foreignKey: "material_id", as: "costHistory" });
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
    current_cost: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      comment: "Nullable: el alta rápida inline puede crear el material sin costo si quien lo crea no tiene permiso material_costs_read",
    },
    currency: {
      type: DataTypes.ENUM("ARS", "USD"),
      allowNull: true,
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
