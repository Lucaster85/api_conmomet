"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class SafetyEquipment extends Model {
    static associate(models) {
      SafetyEquipment.belongsTo(models.Employee, { foreignKey: "employee_id", as: "employee" });
      SafetyEquipment.belongsTo(models.EppItem, { foreignKey: "epp_item_id", as: "eppItem" });
      SafetyEquipment.belongsTo(models.User, { foreignKey: "delivered_by", as: "deliveredBy" });
    }
  }
  SafetyEquipment.init({
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
    size_delivered: {
      type: DataTypes.STRING(10),
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    delivered_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    return_date: {
      type: DataTypes.DATEONLY,
    },
    condition: {
      type: DataTypes.ENUM("new", "good", "worn", "damaged"),
    },
    delivered_by: {
      type: DataTypes.INTEGER,
      references: { model: "Users", key: "id" },
    },
    notes: {
      type: DataTypes.TEXT,
    },
  }, {
    sequelize,
    modelName: "SafetyEquipment",
    tableName: "SafetyEquipments",
    timestamps: true,
    paranoid: true,
    underscored: true,
  });
  return SafetyEquipment;
};
