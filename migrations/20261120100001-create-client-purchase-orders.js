"use strict";
const { DataTypes } = require("sequelize");

/**
 * Órdenes de compra del cliente (PLAN_ARCA.md §3.1, etapa 6). Se llama ClientPurchaseOrder / "OC del cliente" para no confundirse con la `Oca`
 * (remito de horas) ni con `Budget.work_order_number` (OT). Opcional y flexible: un presupuesto puede no tener OC, tener una, o varias vigentes.
 *
 * - ClientPurchaseOrders: número y fecha siempre; monto total sin IVA (null = OC solo de referencia); concepto que cubre; condiciones de pago;
 *   si admite ajuste de precio y de qué tipo; y el estado: active / rejected (rechazada sin reemplazo) / replaced (rechazada y reemplazada por
 *   otra, que la referencia con `replaces_id`). La original rechazada o reemplazada se conserva con su motivo.
 * - ClientPurchaseOrderItems: posiciones (opcionales) de la OC, para poder referenciar "OC 117242-104" desde una línea de factura (etapa 7).
 * - ClientPurchaseOrderFiles: el PDF de la OC y lo que mande el cliente (patrón de QuoteRequestFiles).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const timestamps = {
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
    };

    await queryInterface.createTable("ClientPurchaseOrders", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      budget_id: {
        type: DataTypes.INTEGER, allowNull: false,
        references: { model: "Budgets", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT",
      },
      number: { type: DataTypes.STRING(60), allowNull: false, comment: "Número de OC del cliente." },
      date: { type: DataTypes.DATEONLY, allowNull: false },
      concept: { type: DataTypes.ENUM("materials", "labor", "all"), allowNull: false, defaultValue: "all" },
      currency: { type: DataTypes.ENUM("ARS", "USD"), allowNull: false },
      amount: { type: DataTypes.DECIMAL(14, 2), allowNull: true, comment: "Total sin IVA. Null = OC solo de referencia, sin monto." },
      payment_terms: { type: DataTypes.TEXT, allowNull: true, comment: 'Texto libre, ej. "30% anticipo / 40% avance / 20% finalización / 10% recepción".' },
      allows_adjustment: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      adjustment_type: { type: DataTypes.ENUM("ipc_indec", "uocra", "other"), allowNull: false, defaultValue: "ipc_indec" },
      adjustment_notes: { type: DataTypes.TEXT, allowNull: true },
      status: { type: DataTypes.ENUM("active", "rejected", "replaced"), allowNull: false, defaultValue: "active" },
      rejection_reason: { type: DataTypes.TEXT, allowNull: true },
      replaces_id: {
        type: DataTypes.INTEGER, allowNull: true,
        references: { model: "ClientPurchaseOrders", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL",
        comment: "La OC que esta reemplaza (la original queda rechazada, con su motivo).",
      },
      created_by: {
        type: DataTypes.INTEGER, allowNull: false,
        references: { model: "Users", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT",
      },
      ...timestamps,
    });
    await queryInterface.addIndex("ClientPurchaseOrders", ["budget_id", "status"], { name: "client_po_budget_status_idx" });

    await queryInterface.createTable("ClientPurchaseOrderItems", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      purchase_order_id: {
        type: DataTypes.INTEGER, allowNull: false,
        references: { model: "ClientPurchaseOrders", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE",
      },
      position: { type: DataTypes.STRING(20), allowNull: true, comment: 'Posición de la OC, ej. "10", "20" o "117242-104".' },
      description: { type: DataTypes.STRING(255), allowNull: false },
      amount: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
      created_at: timestamps.created_at,
      updated_at: timestamps.updated_at,
    });
    await queryInterface.addIndex("ClientPurchaseOrderItems", ["purchase_order_id"], { name: "client_po_items_po_idx" });

    await queryInterface.createTable("ClientPurchaseOrderFiles", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      purchase_order_id: {
        type: DataTypes.INTEGER, allowNull: false,
        references: { model: "ClientPurchaseOrders", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE",
      },
      file_url: { type: DataTypes.STRING(500), allowNull: false },
      file_key: { type: DataTypes.STRING(500), allowNull: true },
      file_name: { type: DataTypes.STRING(255), allowNull: true },
      mime_type: { type: DataTypes.STRING(120), allowNull: true },
      size_bytes: { type: DataTypes.INTEGER, allowNull: true },
      uploaded_by: {
        type: DataTypes.INTEGER, allowNull: false,
        references: { model: "Users", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT",
      },
      ...timestamps,
    });
    await queryInterface.addIndex("ClientPurchaseOrderFiles", ["purchase_order_id"], { name: "client_po_files_po_idx" });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("ClientPurchaseOrderFiles");
    await queryInterface.dropTable("ClientPurchaseOrderItems");
    await queryInterface.dropTable("ClientPurchaseOrders");
  },
};
