"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class PayrollConcept extends Model {
    static associate(models) {
      PayrollConcept.hasMany(models.EmployeeRate, { foreignKey: "concept_id", as: "employeeRates" });
      PayrollConcept.hasMany(models.PayrollLine, { foreignKey: "concept_id", as: "payrollLines" });
    }
  }
  PayrollConcept.init({
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    code: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
    },
    calc_type: {
      type: DataTypes.ENUM("hourly", "fixed"),
      allowNull: false,
      defaultValue: "hourly",
    },
    sort_order: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
  }, {
    sequelize,
    modelName: "PayrollConcept",
    tableName: "PayrollConcepts",
    timestamps: true,
    underscored: true,
  });
  return PayrollConcept;
};
