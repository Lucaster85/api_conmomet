"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class AssetAssignment extends Model {
    static associate(models) {
      AssetAssignment.belongsTo(models.Tool, { foreignKey: "tool_id", as: "tool" });
      AssetAssignment.belongsTo(models.Vehicle, { foreignKey: "vehicle_id", as: "vehicle" });
      AssetAssignment.belongsTo(models.Project, { foreignKey: "project_id", as: "project" });
      AssetAssignment.belongsTo(models.Employee, { foreignKey: "employee_id", as: "employee" });
      AssetAssignment.belongsTo(models.User, { foreignKey: "delivered_by", as: "deliveredBy" });
      AssetAssignment.belongsTo(models.User, { foreignKey: "received_by", as: "receivedBy" });
    }
  }
  AssetAssignment.init({
    // Exactamente uno de tool_id/vehicle_id debe estar seteado — validado en
    // assetAssignmentController.js, no a nivel DB (mismo criterio que el resto del sistema).
    tool_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Tools", key: "id" },
    },
    vehicle_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Vehicles", key: "id" },
    },
    project_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Projects", key: "id" },
    },
    employee_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Employees", key: "id" },
      comment: "Responsable: obligatorio si tool_id está seteado, opcional si es vehicle_id — validado en el controller.",
    },
    status: {
      type: DataTypes.ENUM("reserved", "delivered", "returned"),
      allowNull: false,
    },
    delivered_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    returned_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    delivery_condition: {
      type: DataTypes.ENUM("bueno", "regular", "malo"),
      allowNull: true,
    },
    delivery_completeness: {
      type: DataTypes.ENUM("completo", "faltante"),
      allowNull: true,
    },
    delivery_notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    return_condition: {
      type: DataTypes.ENUM("bueno", "regular", "malo"),
      allowNull: true,
    },
    return_completeness: {
      type: DataTypes.ENUM("completo", "faltante"),
      allowNull: true,
    },
    return_notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    delivered_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Users", key: "id" },
    },
    received_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Users", key: "id" },
    },
  }, {
    sequelize,
    modelName: "AssetAssignment",
    tableName: "AssetAssignments",
    timestamps: true,
    paranoid: true,
    underscored: true,
  });
  return AssetAssignment;
};
