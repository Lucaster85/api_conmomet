"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class EmployeeInvitation extends Model {
    static associate(models) {
      EmployeeInvitation.belongsTo(models.Employee, { foreignKey: "employee_id", as: "employee" });
      EmployeeInvitation.belongsTo(models.User, { foreignKey: "created_by", as: "createdBy" });
    }
  }
  EmployeeInvitation.init(
    {
      employee_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Employees", key: "id" },
      },
      token_hash: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
      },
      channel: {
        type: DataTypes.ENUM("email", "whatsapp"),
        allowNull: false,
      },
      expires_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      accepted_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      created_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
      },
    },
    {
      sequelize,
      modelName: "EmployeeInvitation",
      tableName: "EmployeeInvitations",
      timestamps: true,
      paranoid: true,
      underscored: true,
    }
  );
  return EmployeeInvitation;
};
