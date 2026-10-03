"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class QuoteRequest extends Model {
    static associate(models) {
      QuoteRequest.belongsTo(models.Client, { foreignKey: "client_id", as: "client" });
      QuoteRequest.belongsTo(models.Plant, { foreignKey: "plant_id", as: "plant" });
      QuoteRequest.belongsTo(models.User, { foreignKey: "created_by", as: "createdBy" });
      QuoteRequest.hasMany(models.QuoteRequestFile, { foreignKey: "quote_request_id", as: "files" });
      QuoteRequest.hasMany(models.Budget, { foreignKey: "quote_request_id", as: "budgets" });
      QuoteRequest.belongsToMany(models.User, {
        through: "quote_request_assignee",
        as: "assignees",
        foreignKey: "quote_request_id",
      });
    }
  }
  QuoteRequest.init({
    number: {
      type: DataTypes.STRING(30),
      allowNull: false,
      unique: true,
    },
    title: {
      type: DataTypes.STRING(200),
      allowNull: false,
    },
    // Número con el que el CLIENTE identifica su pedido — distinto de `number`, que es nuestro
    // código interno PC-YYYY-NNN. Texto libre a propósito: cada cliente usa su propia
    // nomenclatura, no se valida formato. El Presupuesto lo ve a través de su PC, nunca lo
    // duplica en su propia tabla (ver FLOWS.md flujo 27b).
    client_quote_number: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    client_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Clients", key: "id" },
    },
    plant_id: {
      type: DataTypes.INTEGER,
      references: { model: "Plants", key: "id" },
    },
    description: {
      type: DataTypes.TEXT,
    },
    received_at: {
      type: DataTypes.DATEONLY,
      comment: "Cuándo el cliente mandó el pedido de cotización",
    },
    due_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      comment: "Vencimiento de presentación al cliente — solo advertencia visual, no bloquea ninguna acción (mismo criterio que Budget.validity_days)",
    },
    status: {
      type: DataTypes.ENUM("pending", "in_progress", "pending_review", "quoted", "cancelled"),
      allowNull: false,
      defaultValue: "pending",
      comment: "pending: recién cargado; in_progress: responsable armando el presupuesto; pending_review: devuelto a gerencia para márgenes/validación; quoted: presupuesto enviado al cliente; cancelled: no se cotiza",
    },
    notes: {
      type: DataTypes.TEXT,
    },
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Users", key: "id" },
    },
  }, {
    sequelize,
    modelName: "QuoteRequest",
    tableName: "QuoteRequests",
    timestamps: true,
    paranoid: true,
    underscored: true,
  });
  return QuoteRequest;
};
