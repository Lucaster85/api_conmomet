"use strict";
const { DataTypes } = require("sequelize");

/**
 * Facturación básica (ver FLOWS.md y PLAN_FACTURACION.md). Una factura es un encabezado + líneas
 * por concepto (InvoiceLines). Cubre cuatro casos con el mismo registro:
 * - factura de un presupuesto aprobado (budget_id), parcial o total;
 * - cobro "sin factura" (voucher_type = sin_factura): sin número fiscal y con IVA 0;
 * - factura libre, para proyectos sin presupuesto (budget_id null);
 * - a futuro, factura de una OCA (se sumaría oca_id sin rehacer el modelo).
 * No se borra nunca: se anula (status = cancelled). Paranoid solo por convención del proyecto.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("Invoices", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      voucher_type: { type: DataTypes.ENUM("A", "B", "C", "E", "sin_factura"), allowNull: false },
      pos_number: { type: DataTypes.INTEGER, allowNull: true, comment: "Punto de venta. Null si es sin_factura." },
      number: { type: DataTypes.INTEGER, allowNull: true, comment: "Número del comprobante (0001-00001234). Null si es sin_factura." },
      issue_date: { type: DataTypes.DATEONLY, allowNull: false },
      due_date: { type: DataTypes.DATEONLY, allowNull: true, comment: "Vencimiento de pago (opcional)." },
      client_id: {
        type: DataTypes.INTEGER, allowNull: false,
        references: { model: "Clients", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT",
      },
      budget_id: {
        type: DataTypes.INTEGER, allowNull: true,
        references: { model: "Budgets", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT",
        comment: "Null en factura libre.",
      },
      project_id: {
        type: DataTypes.INTEGER, allowNull: true,
        references: { model: "Projects", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT",
        comment: "Con presupuesto, el del presupuesto. En factura libre es opcional.",
      },
      currency: { type: DataTypes.ENUM("ARS", "USD"), allowNull: false },
      exchange_rate: { type: DataTypes.DECIMAL(14, 4), allowNull: true, comment: "Informativo (queda para ARCA)." },
      net_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false, comment: "Suma de las líneas. Lo calcula el servidor." },
      iva_rate: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 21, comment: "0 si es sin_factura." },
      iva_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
      total_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
      status: { type: DataTypes.ENUM("pending", "paid", "cancelled"), allowNull: false, defaultValue: "pending" },
      paid_at: { type: DataTypes.DATEONLY, allowNull: true },
      cancelled_at: { type: DataTypes.DATE, allowNull: true },
      cancellation_reason: { type: DataTypes.TEXT, allowNull: true },
      file_url: { type: DataTypes.STRING(500), allowNull: true },
      file_key: { type: DataTypes.STRING(500), allowNull: true },
      file_name: { type: DataTypes.STRING(255), allowNull: true },
      cae: { type: DataTypes.STRING(20), allowNull: true, comment: "Para ARCA. Hoy siempre null." },
      cae_expiration: { type: DataTypes.DATEONLY, allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
      created_by: {
        type: DataTypes.INTEGER, allowNull: false,
        references: { model: "Users", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT",
      },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
    });

    await queryInterface.addIndex("Invoices", ["budget_id"], { name: "invoices_budget_idx" });
    await queryInterface.addIndex("Invoices", ["client_id"], { name: "invoices_client_idx" });
    await queryInterface.addIndex("Invoices", ["status"], { name: "invoices_status_idx" });
    // En MySQL los NULL no chocan en un índice único, así que los sin_factura (pos/number null)
    // no colisionan entre sí. El controller valida igual para dar un error legible.
    await queryInterface.addIndex("Invoices", ["voucher_type", "pos_number", "number"], {
      name: "invoices_voucher_unique", unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("Invoices");
  },
};
