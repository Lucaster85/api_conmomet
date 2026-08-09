"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class AuditLog extends Model {
    static associate(models) {
      AuditLog.belongsTo(models.User, { foreignKey: "performed_by", as: "performedByUser" });
    }
  }
  AuditLog.init({
    entity_type: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    entity_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    action: {
      type: DataTypes.ENUM("create", "update", "delete"),
      allowNull: false,
    },
    field_changed: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    previous_value: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    new_value: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    amount: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
    },
    context: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    performed_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Users", key: "id" },
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  }, {
    sequelize,
    modelName: "AuditLog",
    tableName: "AuditLogs",
    timestamps: true,
    underscored: true,
    // Sin paranoid: es un log de auditoría append-only, mismo criterio que MaterialCostHistory.
  });
  return AuditLog;
};
