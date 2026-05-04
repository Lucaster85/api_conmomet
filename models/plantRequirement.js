"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class PlantRequirement extends Model {
    static associate(models) {
      PlantRequirement.belongsTo(models.Plant, { foreignKey: "plant_id", as: "plant" });
      PlantRequirement.belongsTo(models.DocumentCategory, { foreignKey: "document_category_id", as: "documentCategory" });
    }
  }
  PlantRequirement.init({
    plant_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Plants", key: "id" },
    },
    document_category_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "DocumentCategories", key: "id" },
    },
    is_mandatory: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    notes: {
      type: DataTypes.TEXT,
    },
  }, {
    sequelize,
    modelName: "PlantRequirement",
    tableName: "PlantRequirements",
    timestamps: true,
    paranoid: true,
    underscored: true,
  });
  return PlantRequirement;
};
