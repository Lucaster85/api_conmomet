"use strict";
const { DataTypes } = require("sequelize");

/**
 * Notas de crédito y de débito (PLAN_ARCA.md, etapa 5; reglas de saldo en §8, B9).
 * - Invoices.kind: invoice / credit_note / debit_note. Se deriva del tipo de comprobante de ARCA (2, 7, 12, 20, 202 = nota de débito;
 *   3, 8, 13, 21, 203 = nota de crédito), así que las que ya estuvieran cargadas quedan bien clasificadas.
 * - Invoices.associated_invoice_id: la factura original. ARCA lo exige para toda NC/ND (CbtesAsoc, error 10197 si falta).
 * - Invoices.fce_annulment: en una nota de FCE, si se manda la marca de anulación (opcional 22 = "S"). ARCA solo la admite si el
 *   comprador rechazó la FCE (error 10154); el resto de las notas de FCE van con 22 = "N".
 * - InvoiceLines.credits_line_id: la línea de la factura original que acredita una línea de NC. Con eso se sabe cuánto de cada línea ya
 *   se acreditó y se evita acreditar dos veces lo mismo. RESTRICT: no se puede borrar una línea que tiene NC.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("Invoices", "kind", {
      type: DataTypes.ENUM("invoice", "credit_note", "debit_note"), allowNull: false, defaultValue: "invoice",
    });
    await queryInterface.addColumn("Invoices", "associated_invoice_id", {
      type: DataTypes.INTEGER, allowNull: true,
      references: { model: "Invoices", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT",
    });
    await queryInterface.addColumn("Invoices", "fce_annulment", { type: DataTypes.BOOLEAN, allowNull: true });
    await queryInterface.addColumn("InvoiceLines", "credits_line_id", {
      type: DataTypes.INTEGER, allowNull: true,
      references: { model: "InvoiceLines", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT",
    });

    await queryInterface.sequelize.query("UPDATE Invoices SET kind = 'credit_note' WHERE cbte_tipo IN (3, 8, 13, 21, 203)");
    await queryInterface.sequelize.query("UPDATE Invoices SET kind = 'debit_note' WHERE cbte_tipo IN (2, 7, 12, 20, 202)");

    await queryInterface.addIndex("Invoices", ["associated_invoice_id"], { name: "invoices_associated_idx" });
    await queryInterface.addIndex("InvoiceLines", ["credits_line_id"], { name: "invoice_lines_credits_idx" });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex("InvoiceLines", "invoice_lines_credits_idx");
    await queryInterface.removeIndex("Invoices", "invoices_associated_idx");
    await queryInterface.removeColumn("InvoiceLines", "credits_line_id");
    await queryInterface.removeColumn("Invoices", "fce_annulment");
    await queryInterface.removeColumn("Invoices", "associated_invoice_id");
    await queryInterface.removeColumn("Invoices", "kind");
  },
};
