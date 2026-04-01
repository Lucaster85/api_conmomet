'use strict';
const { Model, DataTypes } = require('sequelize');
const sequelize = require("../config/sequelize");

module.exports = () => {
  class Proveedor extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  Proveedor.init({
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
    modelName: 'Provider',
    tableName: "Providers",
    timestamps: true,
    paranoid: true,
    underscored: true,
  });
  return Proveedor;
};