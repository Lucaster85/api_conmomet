"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

// Acuse de vista de un usuario sobre UN item de UN aviso del tablero (ver FLOWS.md flujo 36).
// Una fila por (usuario, tipo de aviso, item): "ya vi este pedido de cotización".
//
// `revision` es un string OPACO para el backend: lo calcula el frontend con los datos que ya
// recibe, y acá solo se guarda y se compara por igualdad. Eso es lo que permite que el item
// reaparezca cuando cambió algo relevante (le comentaron el PC, el documento pasó a vencido) sin
// que el backend tenga que conocer la forma de los 6 recursos distintos, y que sumar un aviso
// nuevo no requiera ningún cambio de API.
//
// NO paranoid, misma razón que PushSubscriptions: una fila soft-deleted retendría el índice único
// (user_id, alert_type, entity_id) y bloquearía para siempre el re-marcado de ese item. "Volver a
// mostrar todo" borra de verdad.
module.exports = () => {
  class UserAlertView extends Model {
    static associate(models) {
      UserAlertView.belongsTo(models.User, { foreignKey: "user_id", as: "user" });
    }
  }
  UserAlertView.init({
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Users", key: "id" },
    },
    alert_type: {
      type: DataTypes.STRING(40),
      allowNull: false,
      comment: "Uno de helpers/alertTypes.js#ALERT_TYPES",
    },
    entity_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: "Id del registro de origen (quote_request.id, entity_document.id, ...)",
    },
    revision: {
      type: DataTypes.STRING(80),
      allowNull: false,
      comment: "String opaco: si difiere del actual, el item vuelve a mostrarse",
    },
    seen_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  }, {
    sequelize,
    modelName: "UserAlertView",
    tableName: "UserAlertViews",
    timestamps: true,
    paranoid: false,
    underscored: true,
  });
  return UserAlertView;
};
