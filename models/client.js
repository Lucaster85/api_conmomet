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
      Client.hasMany(models.ClientItemRate, { foreignKey: "client_id", as: "itemRates" });
      Client.hasOne(models.OcaClientRate, { foreignKey: "client_id", as: "ocaRate" });
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
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    // Datos fiscales opcionales (Facturación / ARCA). El CUIT se guarda normalizado: solo dígitos.
    // La validación del dígito verificador vive en helpers/cuit.js (la hace clientController);
    // acá solo se exige el formato.
    cuit: {
      type: DataTypes.STRING(11),
      allowNull: true,
      validate: { is: { args: /^\d{11}$/, msg: "El CUIT debe tener 11 dígitos." } },
    },
    tax_condition: {
      type: DataTypes.ENUM("responsable_inscripto", "monotributo", "exento", "consumidor_final", "no_responsable"),
      allowNull: true,
    },
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