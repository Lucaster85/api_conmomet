"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class SalaryAdvanceDeletionAlert extends Model {
    static associate(models) {
      SalaryAdvanceDeletionAlert.belongsTo(models.Employee, { foreignKey: "employee_id", as: "employee" });
      SalaryAdvanceDeletionAlert.belongsTo(models.PayPeriod, { foreignKey: "pay_period_id", as: "payPeriod" });
      SalaryAdvanceDeletionAlert.belongsTo(models.User, { foreignKey: "deleted_by", as: "deletedBy" });
    }
  }
  SalaryAdvanceDeletionAlert.init({
    employee_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Employees", key: "id" },
    },
    pay_period_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "PayPeriods", key: "id" },
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    payment_method: {
      type: DataTypes.ENUM("efectivo", "transferencia"),
      allowNull: true,
    },
    justification: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    deleted_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Users", key: "id" },
    },
    dismissed_by: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
  }, {
    sequelize,
    modelName: "SalaryAdvanceDeletionAlert",
    tableName: "SalaryAdvanceDeletionAlerts",
    timestamps: true,
    underscored: true,
  });
  return SalaryAdvanceDeletionAlert;
};
