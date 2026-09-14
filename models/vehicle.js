"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class Vehicle extends Model {
    static associate(models) {
      Vehicle.hasMany(models.TimeEntry, { foreignKey: "vehicle_id", as: "timeEntries" });
      Vehicle.hasMany(models.OcaLine, { foreignKey: "vehicle_id", as: "ocaLines" });
      Vehicle.hasMany(models.VehicleStatusLog, { foreignKey: "vehicle_id", as: "statusLogs" });
      Vehicle.hasMany(models.AssetAssignment, { foreignKey: "vehicle_id", as: "assignments" });
    }
  }
  Vehicle.init(
    {
      brand: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      model: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      plate: {
        type: DataTypes.STRING(30),
        allowNull: false,
        unique: true,
      },
      type: {
        type: DataTypes.ENUM("crane", "truck", "other"),
        allowNull: false,
        defaultValue: "other",
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        allowNull: false,
      },
      // Independiente de is_active a propósito (ver FLOWS.md) — is_active sigue gateando los
      // selects de carga de horas/OCAs, status es el ciclo de vida de asignación del pañol.
      // Sin "lost": no aplica a un vehículo patentado.
      status: {
        type: DataTypes.ENUM("available", "reserved", "delivered", "in_repair", "retired"),
        allowNull: false,
        defaultValue: "available",
      },
    },
    {
      sequelize,
      modelName: "Vehicle",
      tableName: "Vehicles",
      timestamps: true,
      paranoid: true,
      underscored: true,
    }
  );
  return Vehicle;
};
