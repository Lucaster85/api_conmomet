"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class EmployeeDocument extends Model {
    static associate(models) {
      EmployeeDocument.belongsTo(models.Employee, { foreignKey: "employee_id", as: "employee" });
      EmployeeDocument.belongsTo(models.User, { foreignKey: "uploaded_by", as: "uploader" });
    }
  }
  EmployeeDocument.init({
    employee_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Employees", key: "id" },
    },
    title: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    file_url: {
      type: DataTypes.STRING(500),
      allowNull: false,
    },
    file_key: {
      type: DataTypes.STRING(500),
      allowNull: false,
    },
    file_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    file_type: {
      type: DataTypes.STRING(50),
    },
    uploaded_by: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Users", key: "id" },
    },
  }, {
    sequelize,
    modelName: "EmployeeDocument",
    tableName: "EmployeeDocuments",
    timestamps: true,
    paranoid: true,
    underscored: true,
  });
  return EmployeeDocument;
};
