"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class OcaStatusLog extends Model {
    static associate(models) {
      OcaStatusLog.belongsTo(models.Oca, { foreignKey: "oca_id", as: "oca" });
      OcaStatusLog.belongsTo(models.User, { foreignKey: "changed_by", as: "changedByUser" });
    }
  }
  OcaStatusLog.init(
    {
      oca_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Ocas", key: "id" },
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
    },
    {
      sequelize,
      modelName: "OcaStatusLog",
      tableName: "OcaStatusLogs",
      timestamps: true,
      underscored: true,
    }
  );
  return OcaStatusLog;
};
