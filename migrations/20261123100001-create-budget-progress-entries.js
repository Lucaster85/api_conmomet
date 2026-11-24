"use strict";
const { DataTypes } = require("sequelize");

/**
 * Avance real de obra (PLAN_ARCA.md etapa 9, §3.4): una medición PARALELA a la de horas. No la modifica: se muestra al lado en el detalle de facturación.
 * - BudgetProgressEntries: el avance acumulado (%) de un presupuesto, a una fecha. Viene de un certificado del cliente (con número y estado) o se carga a mano.
 * - BudgetProgressEntryFiles: archivos del certificado.
 * - InvoiceLines.progress_entry_id: la línea de factura puede referenciar el avance que factura. RESTRICT: un avance con facturas no se elimina.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const timestamps = {
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
    };
    await queryInterface.createTable("BudgetProgressEntries", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      budget_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Budgets", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      date: { type: DataTypes.DATEONLY, allowNull: false },
      percent: { type: DataTypes.DECIMAL(5, 2), allowNull: false },
      source: { type: DataTypes.ENUM("certificate", "manual"), allowNull: false, defaultValue: "manual" },
      certificate_number: { type: DataTypes.STRING(60), allowNull: true },
      status: { type: DataTypes.ENUM("presented", "approved", "rejected"), allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
      created_by: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Users", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      ...timestamps,
    });
    await queryInterface.addIndex("BudgetProgressEntries", ["budget_id", "date"], { name: "budget_progress_entries_budget_date_idx" });

    await queryInterface.createTable("BudgetProgressEntryFiles", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      progress_entry_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "BudgetProgressEntries", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
      file_url: { type: DataTypes.STRING(500), allowNull: false },
      file_key: { type: DataTypes.STRING(500), allowNull: true },
      file_name: { type: DataTypes.STRING(255), allowNull: true },
      mime_type: { type: DataTypes.STRING(120), allowNull: true },
      size_bytes: { type: DataTypes.INTEGER, allowNull: true },
      uploaded_by: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Users", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      ...timestamps,
    });

    await queryInterface.addColumn("InvoiceLines", "progress_entry_id", {
      type: DataTypes.INTEGER, allowNull: true, references: { model: "BudgetProgressEntries", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT",
    });
    await queryInterface.addIndex("InvoiceLines", ["progress_entry_id"], { name: "invoice_lines_progress_idx" });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex("InvoiceLines", "invoice_lines_progress_idx");
    await queryInterface.removeColumn("InvoiceLines", "progress_entry_id");
    await queryInterface.dropTable("BudgetProgressEntryFiles");
    await queryInterface.dropTable("BudgetProgressEntries");
  },
};
