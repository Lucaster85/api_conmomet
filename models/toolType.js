"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class ToolType extends Model {
    static associate(models) {
      ToolType.hasMany(models.Tool, { foreignKey: "tool_type_id", as: "tools" });
    }
  }
  ToolType.init({
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  }, {
    sequelize,
    modelName: "ToolType",
    tableName: "ToolTypes",
    timestamps: true,
    paranoid: true,
    underscored: true,
  });
  return ToolType;
};
