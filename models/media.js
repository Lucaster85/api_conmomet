"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class Media extends Model {}

  Media.init(
    {
      type: {
        type: DataTypes.ENUM("slider", "card", "logo", "gallery", "banner", "background"),
        allowNull: false,
      },
      title: {
        type: DataTypes.STRING(100)
      },
      description: {
        type: DataTypes.STRING(255)
      },
      url: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      order: {
        type: DataTypes.INTEGER
      },
        is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      }
    },
    {
      sequelize,
      modelName: "Media",
      tableName: "Media",
      timestamps: true,
      paranoid: true,
      underscored: true,
    }
  );
  return Media;
};
