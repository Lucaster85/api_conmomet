"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class Holiday extends Model {
    static associate(models) {
      // No associations needed
    }
  }
  Holiday.init({
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      unique: true,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
  }, {
    sequelize,
    modelName: "Holiday",
    tableName: "Holidays",
    timestamps: true,
    underscored: true,
  });
  return Holiday;
};
