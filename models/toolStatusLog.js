"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class ToolStatusLog extends Model {
    static associate(models) {
      ToolStatusLog.belongsTo(models.Tool, { foreignKey: "tool_id", as: "tool" });
      ToolStatusLog.belongsTo(models.User, { foreignKey: "changed_by", as: "changedByUser" });
      ToolStatusLog.belongsTo(models.Employee, { foreignKey: "responsible_employee_id", as: "responsibleEmployee" });
    }
  }
  ToolStatusLog.init({
    tool_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Tools", key: "id" },
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
    responsible_employee_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Employees", key: "id" },
      comment: "Solo se completa en filas donde to_status='in_repair' — rastro histórico del responsable asignado en ese momento.",
    },
  }, {
    sequelize,
    modelName: "ToolStatusLog",
    tableName: "ToolStatusLogs",
    timestamps: true,
    underscored: true,
  });
  return ToolStatusLog;
};
