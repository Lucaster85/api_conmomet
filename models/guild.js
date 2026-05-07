"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class Guild extends Model {
    static associate(models) {
      Guild.hasMany(models.Category, { foreignKey: "guild_id", as: "categories" });
      Guild.hasMany(models.RateChange, { foreignKey: "guild_id", as: "rateChanges" });
    }
  }
  Guild.init({
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    code: {
      type: DataTypes.STRING(50),
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
    modelName: "Guild",
    tableName: "Guilds",
    timestamps: true,
    underscored: true,
  });
  return Guild;
};
