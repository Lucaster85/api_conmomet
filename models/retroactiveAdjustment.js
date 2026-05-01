"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class RetroactiveAdjustment extends Model {
    static associate(models) {
      RetroactiveAdjustment.belongsTo(models.PayPeriod, { foreignKey: "from_period_id", as: "fromPeriod" });
      RetroactiveAdjustment.belongsTo(models.PayPeriod, { foreignKey: "to_period_id", as: "toPeriod" });
      RetroactiveAdjustment.belongsTo(models.PayPeriod, { foreignKey: "applied_in_period_id", as: "appliedInPeriod" });
      RetroactiveAdjustment.belongsTo(models.User, { foreignKey: "created_by", as: "createdBy" });
    }
  }
  RetroactiveAdjustment.init({
    percentage: {
      type: DataTypes.DECIMAL(6, 2),
      allowNull: false,
      comment: "Porcentaje de aumento retroactivo (ej: 2.0 = 2%)",
    },
    from_period_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "PayPeriods", key: "id" },
      comment: "Primera quincena afectada",
    },
    to_period_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "PayPeriods", key: "id" },
      comment: "Última quincena afectada",
    },
    applied_in_period_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "PayPeriods", key: "id" },
      comment: "Quincena donde se paga el retroactivo",
    },
    applies_to: {
      type: DataTypes.ENUM("all", "hourly", "monthly"),
      allowNull: false,
      defaultValue: "all",
    },
    status: {
      type: DataTypes.ENUM("draft", "applied"),
      allowNull: false,
      defaultValue: "draft",
    },
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Users", key: "id" },
    },
  }, {
    sequelize,
    modelName: "RetroactiveAdjustment",
    tableName: "RetroactiveAdjustments",
    timestamps: true,
    underscored: true,
  });
  return RetroactiveAdjustment;
};
