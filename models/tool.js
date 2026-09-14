"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class Tool extends Model {
    static associate(models) {
      Tool.belongsTo(models.ToolType, { foreignKey: "tool_type_id", as: "toolType" });
      Tool.hasMany(models.ToolStatusLog, { foreignKey: "tool_id", as: "statusLogs" });
      Tool.hasMany(models.AssetAssignment, { foreignKey: "tool_id", as: "assignments" });
    }
  }
  Tool.init({
    tool_type_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "ToolTypes", key: "id" },
    },
    name: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    reference_code: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
      comment: "Manual, único, no editable después de creado — ver toolController.js#update",
    },
    brand: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    model: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    serial_number: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM("available", "reserved", "delivered", "in_repair", "retired", "lost"),
      allowNull: false,
      defaultValue: "available",
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  }, {
    sequelize,
    modelName: "Tool",
    tableName: "Tools",
    timestamps: true,
    paranoid: true,
    underscored: true,
  });
  return Tool;
};
