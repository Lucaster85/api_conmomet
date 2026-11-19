"use strict";

/**
 * Etapa 7 de PLAN_ARCA.md (§3.2): una factura puede cobrar varios presupuestos y varias OC del mismo cliente.
 * - InvoiceLines.budget_id: a qué presupuesto pertenece la línea (de ahí sale el saldo). Se copia desde la cabecera de las facturas existentes.
 * - InvoiceLines.purchase_order_id: la OC contra la que se factura la línea (opcional). RESTRICT: una OC con facturas no se elimina.
 * Invoices.budget_id queda como dato de compatibilidad: tiene el presupuesto cuando todas las líneas son de uno solo y NULL si son de varios.
 * Todas las lecturas pasan a las líneas (PLAN_ARCA.md §8, B10).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    await queryInterface.addColumn("InvoiceLines", "budget_id", {
      type: DataTypes.INTEGER, allowNull: true, references: { model: "Budgets", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT",
    });
    await queryInterface.addColumn("InvoiceLines", "purchase_order_id", {
      type: DataTypes.INTEGER, allowNull: true, references: { model: "ClientPurchaseOrders", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT",
    });

    // Backfill: las líneas de las facturas de un presupuesto heredan su presupuesto. Las facturas libres (sin presupuesto) no tienen.
    await queryInterface.sequelize.query(
      "UPDATE InvoiceLines il JOIN Invoices i ON i.id = il.invoice_id SET il.budget_id = i.budget_id WHERE i.budget_id IS NOT NULL"
    );

    await queryInterface.addIndex("InvoiceLines", ["budget_id"], { name: "invoice_lines_budget_idx" });
    await queryInterface.addIndex("InvoiceLines", ["purchase_order_id"], { name: "invoice_lines_purchase_order_idx" });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex("InvoiceLines", "invoice_lines_purchase_order_idx");
    await queryInterface.removeIndex("InvoiceLines", "invoice_lines_budget_idx");
    await queryInterface.removeColumn("InvoiceLines", "purchase_order_id");
    await queryInterface.removeColumn("InvoiceLines", "budget_id");
  },
};
