'use strict';
const { Model, DataTypes } = require('sequelize');
const sequelize = require("../config/sequelize");

module.exports = () => {
  class Provider extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      Provider.hasMany(models.MaterialProviderPrice, { foreignKey: "provider_id", as: "materialPrices" });
    }
  }
  Provider.init({
    razonSocial: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING(150),
      allowNull: true,
    },
    phone: {
      type: DataTypes.STRING(30),
    },
    is_system: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: "Proveedor 'Sin especificar': aloja los costos sin proveedor. No se puede renombrar ni borrar.",
    },
  }, {
    sequelize,
    modelName: 'Provider',
    tableName: "Providers",
    timestamps: true,
    paranoid: true,
    underscored: true,
  });
  return Provider;
};