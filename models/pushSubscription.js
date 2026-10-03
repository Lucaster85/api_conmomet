"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

// Una fila por dispositivo/browser, no por usuario — la misma persona puede tener el celu y la
// compu suscriptos a la vez. `endpoint` es único a nivel GLOBAL (no por usuario) a propósito:
// si en el mismo celular se desloguea un usuario y entra otro, el browser devuelve el MISMO
// endpoint para el mismo origen — el upsert por endpoint sobrescribe `user_id`, así "el último
// que se autenticó en este dispositivo es el dueño" (ver FLOWS.md flujo 28, celular compartido).
//
// NO paranoid a propósito: una fila soft-deleted retendría el endpoint único y bloquearía para
// siempre la re-suscripción desde ese dispositivo. Una suscripción muerta se borra, no se archiva.
module.exports = () => {
  class PushSubscription extends Model {
    static associate(models) {
      PushSubscription.belongsTo(models.User, { foreignKey: "user_id", as: "user" });
    }
  }
  PushSubscription.init({
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Users", key: "id" },
    },
    endpoint: {
      type: DataTypes.STRING(500),
      allowNull: false,
      unique: true,
      comment: "URL del servicio de push del browser — identifica el dispositivo/instalación, no al usuario",
    },
    p256dh: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    auth: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    user_agent: {
      type: DataTypes.STRING(512),
    },
    last_success_at: {
      type: DataTypes.DATE,
    },
  }, {
    sequelize,
    modelName: "PushSubscription",
    tableName: "PushSubscriptions",
    timestamps: true,
    paranoid: false,
    underscored: true,
  });
  return PushSubscription;
};
