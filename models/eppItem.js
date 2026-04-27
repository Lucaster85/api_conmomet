"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class EppItem extends Model {
    static associate(models) {
      EppItem.hasMany(models.SafetyEquipment, { foreignKey: "epp_item_id", as: "deliveries" });
    }
  }
  EppItem.init({
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
    },
    category: {
      type: DataTypes.ENUM("footwear", "clothing", "head_protection", "hand_protection", "eye_protection", "other"),
      allowNull: false,
    },
    size_type: {
      type: DataTypes.ENUM("none", "numeric", "alpha"),
      allowNull: false,
      defaultValue: "none",
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  }, {
    sequelize,
    modelName: "EppItem",
    tableName: "EppItems",
    timestamps: true,
    paranoid: true,
    underscored: true,
  });
  return EppItem;
};
