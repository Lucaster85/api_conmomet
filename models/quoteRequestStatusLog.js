"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

// Log append-only del ida y vuelta de un PC (ver FLOWS.md flujo 27g). Mismo patrón que
// OcaStatusLog/ToolStatusLog/VehicleStatusLog, con dos desvíos deliberados:
// - `event` explícito en vez de derivarlo de (from_status, to_status): la UI y el texto del
//   push necesitan distinguir "te lo devolvieron" de "te lo asignaron" en varios lugares, y
//   derivarlo repetido es lo que después se desincroniza.
// - `comment` en vez de `notes`: QuoteRequest ya tiene un `notes` con otro significado (notas
//   generales del pedido) — dos cosas distintas no deberían llamarse igual en el mismo flujo.
module.exports = () => {
  class QuoteRequestStatusLog extends Model {
    static associate(models) {
      QuoteRequestStatusLog.belongsTo(models.QuoteRequest, { foreignKey: "quote_request_id", as: "quoteRequest" });
      QuoteRequestStatusLog.belongsTo(models.User, { foreignKey: "changed_by", as: "changedByUser" });
      QuoteRequestStatusLog.belongsToMany(models.User, {
        through: "quote_request_status_log_recipient",
        as: "recipients",
        foreignKey: "log_id",
      });
    }
  }
  QuoteRequestStatusLog.init(
    {
      quote_request_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "QuoteRequests", key: "id" },
      },
      event: {
        type: DataTypes.STRING(30),
        allowNull: false,
        comment: "assigned / delivered / returned / reassigned / cancelled / reopened / quoted",
      },
      from_status: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      to_status: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      changed_by: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Users", key: "id" },
      },
      changed_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      comment: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "QuoteRequestStatusLog",
      tableName: "QuoteRequestStatusLogs",
      timestamps: true,
      underscored: true,
      // Sin paranoid a propósito: es un log append-only, mismo criterio que AuditLog — una fila
      // nunca se edita ni se borra, así que soft-delete no aplica.
    }
  );
  return QuoteRequestStatusLog;
};
