"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class Employee extends Model {
    static associate(models) {
      Employee.belongsTo(models.User, { foreignKey: "user_id", as: "user" });
      Employee.hasMany(models.EntityDocument, { 
        foreignKey: "entity_id",
        constraints: false,
        scope: {
          entity_type: "employee"
        },
        as: "documents" 
      });
      Employee.hasMany(models.TimeEntry, { foreignKey: "employee_id", as: "timeEntries" });
      Employee.hasMany(models.Attendance, { foreignKey: "employee_id", as: "attendances" });
      Employee.hasMany(models.SalaryAdvance, { foreignKey: "employee_id", as: "salaryAdvances" });
      Employee.hasMany(models.SafetyEquipment, { foreignKey: "employee_id", as: "safetyEquipments" });
      Employee.hasMany(models.PayrollEntry, { foreignKey: "employee_id", as: "payrollEntries" });
      Employee.hasMany(models.SalaryHistory, { foreignKey: "employee_id", as: "salaryHistories" });
    }
  }
  Employee.init({
    name: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    lastname: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    dni: {
      type: DataTypes.STRING(10),
      allowNull: false,
      unique: true,
    },
    cuil: {
      type: DataTypes.STRING(13),
      allowNull: false,
      unique: true,
    },
    address: {
      type: DataTypes.STRING(255),
    },
    phone: {
      type: DataTypes.STRING(30),
    },
    email: {
      type: DataTypes.STRING(255),
    },
    position: {
      type: DataTypes.STRING(100),
    },
    hire_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    termination_date: {
      type: DataTypes.DATEONLY,
    },
    status: {
      type: DataTypes.ENUM("active", "inactive", "vacation", "medical_leave"),
      defaultValue: "active",
    },
    hourly_rate: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    pay_type: {
      type: DataTypes.ENUM("hourly", "monthly"),
      defaultValue: "hourly",
      allowNull: false,
    },
    monthly_salary: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    user_id: {
      type: DataTypes.INTEGER,
      references: { model: "Users", key: "id" },
    },
    notes: {
      type: DataTypes.TEXT,
    },
    shoe_size: {
      type: DataTypes.STRING(10),
    },
    shirt_size: {
      type: DataTypes.STRING(10),
    },
    pant_size: {
      type: DataTypes.STRING(10),
    },
  }, {
    sequelize,
    modelName: "Employee",
    tableName: "Employees",
    timestamps: true,
    paranoid: true,
    underscored: true,
  });
  return Employee;
};
