"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class ClientSupervisor extends Model {
    static associate(models) {
      ClientSupervisor.belongsTo(models.Client, { foreignKey: "client_id", as: "client" });
      ClientSupervisor.belongsToMany(models.Project, {
        through: "ProjectSupervisors",
        foreignKey: "supervisor_id",
        otherKey: "project_id",
        as: "projects",
      });
      ClientSupervisor.hasMany(models.TimeEntry, { foreignKey: "supervisor_id", as: "timeEntries" });
      ClientSupervisor.hasMany(models.Oca, { foreignKey: "supervisor_id", as: "ocas" });
    }
  }
  ClientSupervisor.init(
    {
      client_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Clients", key: "id" },
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      lastname: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      email: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
      phone: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: "ClientSupervisor",
      tableName: "ClientSupervisors",
      timestamps: true,
      paranoid: true,
      underscored: true,
    }
  );
  return ClientSupervisor;
};
