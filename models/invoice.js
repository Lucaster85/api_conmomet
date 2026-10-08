"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

// Factura / cobro registrado (ver FLOWS.md, sección Facturación). Encabezado; el detalle por
// concepto vive en InvoiceLine. Nunca se borra: se anula (status = cancelled).
// voucher_type = "sin_factura" es un cobro sin comprobante fiscal: sin número, IVA 0, y solo lo
// ve y lo carga quien tiene invoices_unofficial.
module.exports = () => {
  class Invoice extends Model {
    static associate(models) {
      Invoice.belongsTo(models.Client, { foreignKey: "client_id", as: "client" });
      Invoice.belongsTo(models.Budget, { foreignKey: "budget_id", as: "budget" });
      Invoice.belongsTo(models.Project, { foreignKey: "project_id", as: "project" });
      Invoice.belongsTo(models.User, { foreignKey: "created_by", as: "createdBy" });
      Invoice.hasMany(models.InvoiceLine, { foreignKey: "invoice_id", as: "lines" });
    }
  }
  Invoice.init({
    voucher_type: { type: DataTypes.ENUM("A", "B", "C", "E", "sin_factura"), allowNull: false },
    pos_number: { type: DataTypes.INTEGER, allowNull: true },
    number: { type: DataTypes.INTEGER, allowNull: true },
    issue_date: { type: DataTypes.DATEONLY, allowNull: false },
    due_date: { type: DataTypes.DATEONLY, allowNull: true },
    client_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Clients", key: "id" } },
    budget_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: "Budgets", key: "id" } },
    project_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: "Projects", key: "id" } },
    currency: { type: DataTypes.ENUM("ARS", "USD"), allowNull: false },
    exchange_rate: { type: DataTypes.DECIMAL(14, 4), allowNull: true },
    net_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    iva_rate: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 21 },
    iva_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    total_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    status: { type: DataTypes.ENUM("pending", "paid", "cancelled"), allowNull: false, defaultValue: "pending" },
    paid_at: { type: DataTypes.DATEONLY, allowNull: true },
    cancelled_at: { type: DataTypes.DATE, allowNull: true },
    cancellation_reason: { type: DataTypes.TEXT, allowNull: true },
    file_url: { type: DataTypes.STRING(500), allowNull: true },
    file_key: { type: DataTypes.STRING(500), allowNull: true },
    file_name: { type: DataTypes.STRING(255), allowNull: true },
    // Comprobante de pago, opcional, que se adjunta al marcar la factura como cobrada.
    payment_file_url: { type: DataTypes.STRING(500), allowNull: true },
    payment_file_key: { type: DataTypes.STRING(500), allowNull: true },
    payment_file_name: { type: DataTypes.STRING(255), allowNull: true },
    cae: { type: DataTypes.STRING(20), allowNull: true },
    cae_expiration: { type: DataTypes.DATEONLY, allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
    created_by: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Users", key: "id" } },
  }, {
    sequelize,
    modelName: "Invoice",
    tableName: "Invoices",
    timestamps: true,
    paranoid: true,
    underscored: true,
  });
  return Invoice;
};
