"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class PayrollAdjustment extends Model {
    static associate(models) {
      PayrollAdjustment.belongsTo(models.PayrollEntry, { foreignKey: "payroll_entry_id", as: "payrollEntry" });
      PayrollAdjustment.belongsTo(models.User, { foreignKey: "created_by", as: "createdBy" });
      PayrollAdjustment.belongsTo(models.User, { foreignKey: "updated_by", as: "updatedBy" });
    }
  }
  PayrollAdjustment.init({
    payroll_entry_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "PayrollEntries", key: "id" },
    },
    label: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    type: {
      type: DataTypes.ENUM("bonus", "deduction"),
      allowNull: false,
    },
    is_auto: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
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
    modelName: "PayrollAdjustment",
    tableName: "PayrollAdjustments",
    timestamps: true,
    underscored: true,
  });
  return PayrollAdjustment;
};
