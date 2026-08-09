"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class MaterialUnit extends Model {
    static associate(models) {
      MaterialUnit.hasMany(models.BudgetMaterialItem, { foreignKey: "material_unit_id", as: "materialItems" });
    }
  }
  MaterialUnit.init({
    label: {
      type: DataTypes.STRING(20),
      allowNull: false,
      unique: true,
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
    modelName: "MaterialUnit",
    tableName: "MaterialUnits",
    timestamps: true,
    paranoid: true,
    underscored: true,
  });
  return MaterialUnit;
};
