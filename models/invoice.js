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
      Invoice.belongsTo(models.CompanyPointOfSale, { foreignKey: "point_of_sale_id", as: "pointOfSale" });
      Invoice.belongsTo(models.CompanyBankAccount, { foreignKey: "bank_account_id", as: "bankAccount" });
      // Nota de crédito o de débito -> su factura original.
      Invoice.belongsTo(models.Invoice, { foreignKey: "associated_invoice_id", as: "associatedInvoice" });
      Invoice.hasMany(models.Invoice, { foreignKey: "associated_invoice_id", as: "relatedNotes" });
      // Factura de ajuste -> la factura que ajusta (etapa 8).
      Invoice.belongsTo(models.Invoice, { foreignKey: "adjusts_invoice_id", as: "adjustedInvoice" });
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
    exchange_rate: { type: DataTypes.DECIMAL(18, 6), allowNull: true },
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
    // --- Emisión por ARCA (PLAN_ARCA.md, etapa 2). `source`/`arca_status` son la máquina de estados de la emisión; `status`
    // sigue siendo el de cobro (pendiente / cobrada / anulada). cbte_tipo es el código de ARCA y entra en la clave única.
    cbte_tipo: { type: DataTypes.INTEGER, allowNull: true },
    source: { type: DataTypes.ENUM("manual", "arca"), allowNull: false, defaultValue: "manual" },
    arca_status: { type: DataTypes.ENUM("manual", "draft", "authorizing", "authorized", "rejected"), allowNull: false, defaultValue: "manual" },
    arca_env: { type: DataTypes.ENUM("homologacion", "produccion"), allowNull: true },
    arca_concept: { type: DataTypes.INTEGER, allowNull: true },
    service_from: { type: DataTypes.DATEONLY, allowNull: true },
    service_to: { type: DataTypes.DATEONLY, allowNull: true },
    recipient_doc_type: { type: DataTypes.INTEGER, allowNull: true },
    recipient_doc_number: { type: DataTypes.STRING(11), allowNull: true },
    recipient_vat_condition_id: { type: DataTypes.INTEGER, allowNull: true },
    point_of_sale_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: "CompanyPointsOfSale", key: "id" } },
    same_currency_payment: { type: DataTypes.BOOLEAN, allowNull: true },
    total_amount_ars: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    sale_condition: { type: DataTypes.STRING(60), allowNull: true },
    remito_number: { type: DataTypes.STRING(30), allowNull: true },
    commercial_reference: { type: DataTypes.STRING(255), allowNull: true },
    authorized_at: { type: DataTypes.DATE, allowNull: true },
    // FCE MiPyMEs (etapa 4): cuenta del emisor, opción de transferencia y aceptación del cliente (esta última se carga a mano).
    // Notas (etapa 5): kind distingue la factura de sus notas de crédito y débito, asociadas a la original.
    kind: { type: DataTypes.ENUM("invoice", "credit_note", "debit_note"), allowNull: false, defaultValue: "invoice" },
    associated_invoice_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: "Invoices", key: "id" } },
    // Ajustes (etapa 8): la factura que esta ajusta. `active_adjusts_invoice_id` es una columna generada de la base (única): no se define acá.
    adjusts_invoice_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: "Invoices", key: "id" } },
    // Nota por diferencia de cambio (etapa 10): en pesos, sobre una factura en dólares. Guarda los datos del cálculo.
    exchange_difference: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    exchange_diff_base_rate: { type: DataTypes.DECIMAL(18, 6), allowNull: true },
    exchange_diff_new_rate: { type: DataTypes.DECIMAL(18, 6), allowNull: true },
    exchange_diff_base_usd: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    fce_annulment: { type: DataTypes.BOOLEAN, allowNull: true },
    bank_account_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: "CompanyBankAccounts", key: "id" } },
    fce_transfer_option: { type: DataTypes.ENUM("SCA", "ADC"), allowNull: true },
    fce_acceptance: { type: DataTypes.ENUM("pending", "accepted", "rejected"), allowNull: true },
    fce_acceptance_at: { type: DataTypes.DATE, allowNull: true },
    arca_result: { type: DataTypes.JSON, allowNull: true },
    issuer_snapshot: { type: DataTypes.JSON, allowNull: true },
    recipient_snapshot: { type: DataTypes.JSON, allowNull: true },
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
