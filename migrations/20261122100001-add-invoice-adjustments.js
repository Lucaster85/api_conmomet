"use strict";
const { DataTypes } = require("sequelize");

/**
 * Ajustes de precio (PLAN_ARCA.md etapa 8, §3.3): el ajuste (IPC, UOCRA…) se factura como una FACTURA NUEVA vinculada a la original, sin tocar el saldo
 * del presupuesto ni de la OC.
 * - Invoices.adjusts_invoice_id: la factura que ajusta. Una factura es "de ajuste" si lo tiene (no se agregó un `kind`: sigue siendo una factura común
 *   para la emisión, las notas de crédito y los listados). RESTRICT sin CASCADE: MySQL no admite acciones referenciales de ese tipo sobre la base de
 *   una columna generada.
 * - Invoices.active_adjusts_invoice_id: columna GENERADA = adjusts_invoice_id mientras la factura de ajuste no está anulada, si no NULL. Su índice ÚNICO
 *   es la segunda barrera de "un solo ajuste vigente por factura" (MySQL no tiene índices parciales); la primera es la validación bajo FOR UPDATE.
 * - InvoiceLines.concept suma 'adjustment'. Las líneas de ajuste llevan adjusts_line_id (la línea que ajustan), el tipo, el porcentaje y la base.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("Invoices", "adjusts_invoice_id", {
      type: DataTypes.INTEGER, allowNull: true, references: { model: "Invoices", key: "id" }, onDelete: "RESTRICT",
    });
    await queryInterface.sequelize.query(
      "ALTER TABLE Invoices ADD COLUMN active_adjusts_invoice_id INT GENERATED ALWAYS AS (IF(status <> 'cancelled', adjusts_invoice_id, NULL)) STORED, "
      + "ADD UNIQUE INDEX invoices_active_adjusts_unique (active_adjusts_invoice_id)"
    );

    await queryInterface.changeColumn("InvoiceLines", "concept", { type: DataTypes.ENUM("materials", "labor", "other", "adjustment"), allowNull: false });
    await queryInterface.addColumn("InvoiceLines", "adjusts_line_id", {
      type: DataTypes.INTEGER, allowNull: true, references: { model: "InvoiceLines", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT",
    });
    await queryInterface.addColumn("InvoiceLines", "adjustment_type", { type: DataTypes.ENUM("ipc_indec", "uocra", "other"), allowNull: true });
    await queryInterface.addColumn("InvoiceLines", "adjustment_percent", { type: DataTypes.DECIMAL(7, 4), allowNull: true });
    await queryInterface.addColumn("InvoiceLines", "adjustment_base_amount", { type: DataTypes.DECIMAL(14, 2), allowNull: true });
    await queryInterface.addIndex("InvoiceLines", ["adjusts_line_id"], { name: "invoice_lines_adjusts_idx" });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex("InvoiceLines", "invoice_lines_adjusts_idx");
    await queryInterface.removeColumn("InvoiceLines", "adjustment_base_amount");
    await queryInterface.removeColumn("InvoiceLines", "adjustment_percent");
    await queryInterface.removeColumn("InvoiceLines", "adjustment_type");
    await queryInterface.removeColumn("InvoiceLines", "adjusts_line_id");
    await queryInterface.sequelize.query("DELETE FROM InvoiceLines WHERE concept = 'adjustment'");
    await queryInterface.changeColumn("InvoiceLines", "concept", { type: DataTypes.ENUM("materials", "labor", "other"), allowNull: false });
    await queryInterface.sequelize.query("ALTER TABLE Invoices DROP INDEX invoices_active_adjusts_unique, DROP COLUMN active_adjusts_invoice_id");
    await queryInterface.removeColumn("Invoices", "adjusts_invoice_id");
  },
};
