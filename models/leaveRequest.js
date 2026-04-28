"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class LeaveRequest extends Model {
    static associate(models) {
      LeaveRequest.belongsTo(models.Employee, { foreignKey: "employee_id", as: "employee" });
      LeaveRequest.belongsTo(models.User, { foreignKey: "requested_by", as: "requester" });
      LeaveRequest.belongsTo(models.User, { foreignKey: "approved_by", as: "approver" });
    }
  }
  LeaveRequest.init({
    employee_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Employees", key: "id" },
    },
    leave_type: {
      type: DataTypes.ENUM("vacation", "medical_leave", "justified", "other"),
      allowNull: false,
    },
    start_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    end_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    total_days: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("pending", "approved", "rejected", "cancelled"),
      defaultValue: "pending",
      allowNull: false,
    },
    notes: {
      type: DataTypes.TEXT,
    },
    document_url: {
      type: DataTypes.STRING(500),
    },
    document_key: {
      type: DataTypes.STRING(500),
    },
    document_name: {
      type: DataTypes.STRING(255),
    },
    requested_by: {
      type: DataTypes.INTEGER,
      references: { model: "Users", key: "id" },
    },
    approved_by: {
      type: DataTypes.INTEGER,
      references: { model: "Users", key: "id" },
    },
    approved_at: {
      type: DataTypes.DATE,
    },
  }, {
    sequelize,
    modelName: "LeaveRequest",
    tableName: "LeaveRequests",
    timestamps: true,
    paranoid: true,
    underscored: true,
  });
  return LeaveRequest;
};
