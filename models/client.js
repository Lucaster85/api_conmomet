"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class Client extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      Client.hasMany(models.ClientSupervisor, { foreignKey: "client_id", as: "supervisors" });
      Client.hasMany(models.Oca, { foreignKey: "client_id", as: "ocas" });
    }
  }
  Client.init({
    razonSocial: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    phone: {
      type: DataTypes.STRING(30),
    }
    }, {
    sequelize,
    modelName: 'Client',
    tableName: "Clients",
    timestamps: true,
    paranoid: true,
    underscored: true,
  });
  return Client;
};