"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class BudgetMaterialItem extends Model {
    static associate(models) {
      BudgetMaterialItem.belongsTo(models.Budget, { foreignKey: "budget_id", as: "budget" });
      BudgetMaterialItem.belongsTo(models.MaterialUnit, { foreignKey: "material_unit_id", as: "materialUnit" });
      BudgetMaterialItem.belongsTo(models.Material, { foreignKey: "material_id", as: "material" });
    }
  }
  BudgetMaterialItem.init({
    budget_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Budgets", key: "id" },
    },
    material_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Materials", key: "id" },
      comment: "Vínculo opcional al catálogo de materiales — una línea puede seguir siendo solo texto libre",
    },
    description: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    quantity: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    material_unit_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "MaterialUnits", key: "id" },
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
    total_price: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
    },
    material_cost_snapshot: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      comment: "Costo del Material al momento de vincular esta línea — foto fija, no se recalcula después",
    },
    material_cost_currency: {
      type: DataTypes.ENUM("ARS", "USD"),
      allowNull: true,
    },
    margin_percent: {
      type: DataTypes.DECIMAL(6, 2),
      allowNull: false,
      defaultValue: 0,
      comment: "Margen % sobre material_cost_snapshot — unit_price se calcula desde acá, no se carga directo",
    },
    notes: {
      type: DataTypes.TEXT,
    },
  }, {
    sequelize,
    modelName: "BudgetMaterialItem",
    tableName: "BudgetMaterialItems",
    timestamps: true,
    paranoid: true,
    underscored: true,
  });
  return BudgetMaterialItem;
};
