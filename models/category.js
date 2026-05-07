"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class Category extends Model {
    static associate(models) {
      Category.hasMany(models.Employee, { foreignKey: "category_id", as: "employees" });
      Category.belongsTo(models.Guild, { foreignKey: "guild_id", as: "guild" });
    }
  }

  Category.init(
    {
      guild_id: {
        type: DataTypes.INTEGER,
        allowNull: true, // Should be false eventually
        references: { model: "Guilds", key: "id" },
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      guild_hourly_rate: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        comment: "Valor hora según convenio colectivo de trabajo (CCT)",
      },
    },
    {
      sequelize,
      modelName: "Category",
      tableName: "Categories",
      timestamps: true,
      paranoid: true,
      underscored: true,
    }
  );

  return Category;
};
