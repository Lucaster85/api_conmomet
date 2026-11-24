"use strict";
const { DataTypes } = require("sequelize");

/**
 * Factura libre por ARCA a un cliente ocasional (la venta de un vehículo de la empresa, por ejemplo): el comprador no existe en Clientes, así que sus datos
 * se escriben a mano y quedan en la factura.
 * - Invoices.manual_recipient (JSON): { legal_name, cuit, tax_condition, fiscal_street, fiscal_locality, fiscal_province } mientras es borrador. Al emitir se congela en
 *   `recipient_snapshot`, como con cualquier cliente.
 * - Invoices.client_id pasa a admitir NULL: una factura con receptor manual no tiene cliente cargado. Sigue siendo obligatorio salvo con receptor manual (lo valida el controller).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("Invoices", "manual_recipient", { type: DataTypes.JSON, allowNull: true });
    // MODIFY conserva la clave foránea: solo cambia la nulabilidad.
    await queryInterface.sequelize.query("ALTER TABLE Invoices MODIFY client_id INT NULL");
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query("DELETE FROM InvoiceLines WHERE invoice_id IN (SELECT id FROM Invoices WHERE client_id IS NULL)");
    await queryInterface.sequelize.query("DELETE FROM Invoices WHERE client_id IS NULL");
    await queryInterface.sequelize.query("ALTER TABLE Invoices MODIFY client_id INT NOT NULL");
    await queryInterface.removeColumn("Invoices", "manual_recipient");
  },
};
