"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class RateChange extends Model {
    static associate(models) {
      RateChange.belongsTo(models.Guild, { foreignKey: "guild_id", as: "guild" });
      RateChange.belongsTo(models.PayrollConcept, { foreignKey: "concept_id", as: "concept" });
      RateChange.belongsTo(models.PayPeriod, { foreignKey: "applies_from_period", as: "appliesFromPeriod" });
      RateChange.belongsTo(models.PayPeriod, { foreignKey: "applied_in_period", as: "appliedInPeriod" });
      RateChange.belongsTo(models.User, { foreignKey: "created_by", as: "createdBy" });
      RateChange.belongsTo(models.User, { foreignKey: "updated_by", as: "updatedBy" });
    }
  }
  RateChange.init({
    guild_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Guilds", key: "id" },
    },
    concept_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "PayrollConcepts", key: "id" },
    },
    percentage: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: false,
    },
    applies_from_period: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "PayPeriods", key: "id" },
    },
    applied_in_period: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "PayPeriods", key: "id" },
    },
    status: {
      type: DataTypes.ENUM("pending", "applied", "cancelled"),
      allowNull: false,
      defaultValue: "pending",
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Users", key: "id" },
    },
    updated_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Users", key: "id" },
    },
  }, {
    sequelize,
    modelName: "RateChange",
    tableName: "RateChanges",
    timestamps: true,
    underscored: true,
  });
  return RateChange;
};
