"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class OcaClientRate extends Model {
    static associate(models) {
      OcaClientRate.belongsTo(models.Client, { foreignKey: "client_id", as: "client" });
      OcaClientRate.belongsTo(models.Vehicle, { foreignKey: "vehicle_id", as: "vehicle" });
      OcaClientRate.belongsTo(models.User, { foreignKey: "updated_by", as: "updatedBy" });
    }
  }
  OcaClientRate.init({
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
      comment: "NULL para man_hours (un valor por cliente); obligatorio para crane_hours (un valor por cliente y vehículo).",
    },
    hourly_rate: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    updated_by: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Users", key: "id" },
    },
  }, {
    sequelize,
    modelName: "OcaClientRate",
    tableName: "OcaClientRates",
    timestamps: true,
    underscored: true,
    // Sin paranoid: valor "actual" por (client_id, oca_type, vehicle_id), igual criterio que
    // ClientItemRate —
    // el histórico vive en OcaClientRateHistory. Deliberadamente separado de ClientItemRate: es un
    // concepto de precio distinto (valor de referencia OCA), no debe aparecer en Presupuestos.
  });
  return OcaClientRate;
};
