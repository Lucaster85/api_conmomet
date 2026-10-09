"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class EmployeeSize extends Model {
    static associate(models) {
      EmployeeSize.belongsTo(models.Employee, { foreignKey: "employee_id", as: "employee" });
      EmployeeSize.belongsTo(models.EppItem, { foreignKey: "epp_item_id", as: "eppItem" });
    }
  }
  EmployeeSize.init({
    employee_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Employees", key: "id" },
    },
    epp_item_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "EppItems", key: "id" },
    },
    size: {
      type: DataTypes.STRING(10),
      allowNull: false,
    },
  }, {
    sequelize,
    modelName: "EmployeeSize",
    tableName: "EmployeeSizes",
    timestamps: true,
    underscored: true,
  });
  return EmployeeSize;
};
