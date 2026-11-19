"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

// Una línea por concepto de una factura. `percent` es el porcentaje del concepto del presupuesto
// que cubre esta línea (null en "other"). Las columnas base_* son una foto del bruto, el
// descuento y el neto del concepto al momento de facturar. Sin paranoid: se borran junto con la
// factura (CASCADE) y se recrean cuando se corrige la factura.
module.exports = () => {
  class InvoiceLine extends Model {
    static associate(models) {
      InvoiceLine.belongsTo(models.Invoice, { foreignKey: "invoice_id", as: "invoice" });
      InvoiceLine.belongsTo(models.Budget, { foreignKey: "budget_id", as: "budget" });
      InvoiceLine.belongsTo(models.ClientPurchaseOrder, { foreignKey: "purchase_order_id", as: "purchaseOrder" });
      InvoiceLine.belongsTo(models.BudgetProgressEntry, { foreignKey: "progress_entry_id", as: "progressEntry" });
    }
  }
  InvoiceLine.init({
    invoice_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Invoices", key: "id" } },
    // Presupuesto de la línea (de ahí sale el saldo) y OC contra la que se factura (opcional). PLAN_ARCA.md §3.2, FLOWS.md §70.
    budget_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: "Budgets", key: "id" } },
    purchase_order_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: "ClientPurchaseOrders", key: "id" } },
    // El avance real de obra que factura la línea (etapa 9, opcional).
    progress_entry_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: "BudgetProgressEntries", key: "id" } },
    // Solo en líneas de una nota de crédito: la línea de la factura original que acredita.
    credits_line_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: "InvoiceLines", key: "id" } },
    concept: { type: DataTypes.ENUM("materials", "labor", "other", "adjustment"), allowNull: false },
    // Solo en líneas de ajuste (etapa 8): la línea de la factura original que ajusta, el índice, el % aplicado y la base sobre la que se calculó.
    adjusts_line_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: "InvoiceLines", key: "id" } },
    adjustment_type: { type: DataTypes.ENUM("ipc_indec", "uocra", "other"), allowNull: true },
    adjustment_percent: { type: DataTypes.DECIMAL(7, 4), allowNull: true },
    adjustment_base_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    description: { type: DataTypes.STRING(255), allowNull: true },
    percent: { type: DataTypes.DECIMAL(7, 4), allowNull: true },
    net_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    base_gross_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    base_discount_percent: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
    base_net_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
  }, {
    sequelize,
    modelName: "InvoiceLine",
    tableName: "InvoiceLines",
    timestamps: true,
    underscored: true,
  });
  return InvoiceLine;
};
