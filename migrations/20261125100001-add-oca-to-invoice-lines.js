"use strict";
const { DataTypes } = require("sequelize");

/**
 * Facturar OCAs (PLAN_ARCA.md etapa 10, FLOWS.md §74): una línea de factura puede cobrar una OCA entera (horas hombre o de grúa, ya aprobada y con su precio).
 * - InvoiceLines.oca_id: la OCA que cobra la línea. RESTRICT: una OCA con facturas no se borra. Una OCA se factura UNA vez: mientras haya una factura vigente
 *   (no anulada) con esa línea, no se puede facturar de nuevo (se valida con las OCA bloqueadas; anular la factura la libera).
 * - InvoiceLines.concept suma 'oca'. No es materiales ni mano de obra de un presupuesto: no descuenta ni toca ningún saldo.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.changeColumn("InvoiceLines", "concept", { type: DataTypes.ENUM("materials", "labor", "other", "adjustment", "oca"), allowNull: false });
    await queryInterface.addColumn("InvoiceLines", "oca_id", {
      type: DataTypes.INTEGER, allowNull: true, references: { model: "Ocas", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT",
    });
    await queryInterface.addIndex("InvoiceLines", ["oca_id"], { name: "invoice_lines_oca_idx" });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex("InvoiceLines", "invoice_lines_oca_idx");
    await queryInterface.removeColumn("InvoiceLines", "oca_id");
    await queryInterface.sequelize.query("DELETE FROM InvoiceLines WHERE concept = 'oca'");
    await queryInterface.changeColumn("InvoiceLines", "concept", { type: DataTypes.ENUM("materials", "labor", "other", "adjustment"), allowNull: false });
  },
};
