"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class OcaClientRateHistory extends Model {
    static associate(models) {
      OcaClientRateHistory.belongsTo(models.Client, { foreignKey: "client_id", as: "client" });
      OcaClientRateHistory.belongsTo(models.Vehicle, { foreignKey: "vehicle_id", as: "vehicle" });
      OcaClientRateHistory.belongsTo(models.User, { foreignKey: "changed_by", as: "changedBy" });
    }
  }
  OcaClientRateHistory.init({
    client_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Clients", key: "id" },
    },
    oca_type: {
      type: DataTypes.ENUM("man_hours", "crane_hours"),
      allowNull: false,
    },
    vehicle_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Vehicles", key: "id" },
      comment: "NULL para man_hours; obligatorio para crane_hours — historial por cliente y vehículo.",
    },
    hourly_rate: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    changed_by: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Users", key: "id" },
    },
  }, {
    sequelize,
    modelName: "OcaClientRateHistory",
    tableName: "OcaClientRateHistories",
    timestamps: true,
    underscored: true,
    // Sin paranoid: es un log de auditoría append-only — mismo criterio que ClientItemRateHistory.
  });
  return OcaClientRateHistory;
};
