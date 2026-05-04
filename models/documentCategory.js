"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class DocumentCategory extends Model {
    static associate(models) {
      DocumentCategory.hasMany(models.PlantRequirement, { foreignKey: "document_category_id", as: "plantRequirements" });
      DocumentCategory.hasMany(models.EntityDocument, { foreignKey: "document_category_id", as: "documents" });
    }
  }
  DocumentCategory.init({
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
    },
    applies_to: {
      type: DataTypes.ENUM("employee", "vehicle", "project", "company"),
      allowNull: false,
      defaultValue: "employee",
    },
    is_plant_specific: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  }, {
    sequelize,
    modelName: "DocumentCategory",
    tableName: "DocumentCategories",
    timestamps: true,
    paranoid: true,
    underscored: true,
  });
  return DocumentCategory;
};
