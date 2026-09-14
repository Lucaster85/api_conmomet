"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class VehicleStatusLog extends Model {
    static associate(models) {
      VehicleStatusLog.belongsTo(models.Vehicle, { foreignKey: "vehicle_id", as: "vehicle" });
      VehicleStatusLog.belongsTo(models.User, { foreignKey: "changed_by", as: "changedByUser" });
    }
  }
  VehicleStatusLog.init({
    vehicle_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Vehicles", key: "id" },
    },
    from_status: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    to_status: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    changed_by: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Users", key: "id" },
    },
    changed_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  }, {
    sequelize,
    modelName: "VehicleStatusLog",
    tableName: "VehicleStatusLogs",
    timestamps: true,
    underscored: true,
  });
  return VehicleStatusLog;
};
