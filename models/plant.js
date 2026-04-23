"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class Plant extends Model {
    static associate(models) {
      Plant.belongsTo(models.Client, { foreignKey: "client_id", as: "client" });
    }
  }
  Plant.init({
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
    },
    address: {
      type: DataTypes.STRING(255),
    },
    client_id: {
      type: DataTypes.INTEGER,
      references: { model: "Clients", key: "id" },
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    notes: {
      type: DataTypes.TEXT,
    },
  }, {
    sequelize,
    modelName: "Plant",
    tableName: "Plants",
    timestamps: true,
    paranoid: true,
    underscored: true,
  });
  return Plant;
};
