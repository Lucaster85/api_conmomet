"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

// Una notificación entregada a UN usuario (ver FLOWS.md flujo 37). Es el historial consultable de
// lo que antes solo salía como push fire-and-forget (flujo 28): si el push no llegaba, no quedaba
// ningún rastro para el usuario.
//
// Una fila POR DESTINATARIO, no una fila con muchos destinatarios: `read_at` es por persona, y
// con una M2M haría falta una tabla intermedia con su propia columna de leído para expresar lo
// mismo. El costo es duplicar título y cuerpo por destinatario, que para el volumen de conmomet
// (decenas de notificaciones por evento, en el peor caso) es irrelevante.
//
// NO paranoid: es append-only como AuditLog y QuoteRequestStatusLog. Una notificación no se
// edita; se marca leída, y se poda por antigüedad.
module.exports = () => {
  class Notification extends Model {
    static associate(models) {
      Notification.belongsTo(models.User, { foreignKey: "user_id", as: "user" });
      Notification.belongsTo(models.User, { foreignKey: "created_by", as: "createdByUser" });
    }
  }
  Notification.init({
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Users", key: "id" },
      comment: "Destinatario",
    },
    type: {
      type: DataTypes.STRING(40),
      allowNull: false,
      comment: "Uno de helpers/notificationTypes.js#NOTIFICATION_TYPES",
    },
    // Más largos que los topes del push (60/150 en helpers/pushService.js#truncate) a propósito:
    // el payload cifrado de Web Push tiene ~4KB de límite, la base no. Así la campanita muestra
    // el comentario completo aunque al celular le haya llegado cortado.
    title: {
      type: DataTypes.STRING(120),
      allowNull: false,
    },
    body: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    url: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: "Path del frontend al que lleva el click",
    },
    entity_type: {
      type: DataTypes.STRING(40),
      allowNull: true,
      comment: "quote_request / budget — para agrupar e iconizar",
    },
    entity_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    read_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "NULL = no leída",
    },
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Users", key: "id" },
      comment: "Quién la generó; NULL = sistema (cron)",
    },
  }, {
    sequelize,
    modelName: "Notification",
    tableName: "Notifications",
    timestamps: true,
    paranoid: false,
    underscored: true,
  });
  return Notification;
};
