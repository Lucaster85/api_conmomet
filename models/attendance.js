"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class Attendance extends Model {
    static associate(models) {
      Attendance.belongsTo(models.Employee, { foreignKey: "employee_id", as: "employee" });
    }
  }
  Attendance.init({
    employee_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Employees", key: "id" },
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("absent", "justified", "vacation", "medical_leave"),
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
  }, {
    sequelize,
    modelName: "Attendance",
    tableName: "Attendances",
    timestamps: true,
    paranoid: true,
    underscored: true,
  });
  return Attendance;
};
