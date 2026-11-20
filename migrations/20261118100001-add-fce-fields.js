"use strict";
const { DataTypes } = require("sequelize");

/**
 * Factura de Crédito Electrónica MiPyMEs (PLAN_ARCA.md, etapa 4).
 * - Invoices.bank_account_id: la cuenta del emisor (CBU y alias) que se informa a ARCA y se imprime. El CBU y el alias quedan
 *   además congelados en `issuer_snapshot` al autorizar. RESTRICT: una cuenta usada en facturas no se puede eliminar, se desactiva.
 * - Invoices.fce_transfer_option: SCA (sistema de circulación abierta) o ADC (agente de depósito colectivo). Se elige al facturar.
 * - Invoices.fce_acceptance: estado de aceptación del cliente (pendiente / aceptada / rechazada). Se carga A MANO: consultarlo en ARCA
 *   automáticamente (wsfecred) es una etapa futura.
 * - Clients.fce_transfer_option: la opción propia del cliente (null = usa la de la empresa). Bunge, por ejemplo, exige ADC.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("Clients", "fce_transfer_option", {
      type: DataTypes.ENUM("SCA", "ADC"), allowNull: true, comment: "Opción de transferencia de la FCE de este cliente. Null = usa la de la empresa.",
    });
    await queryInterface.addColumn("Invoices", "bank_account_id", {
      type: DataTypes.INTEGER, allowNull: true,
      references: { model: "CompanyBankAccounts", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT",
    });
    await queryInterface.addColumn("Invoices", "fce_transfer_option", { type: DataTypes.ENUM("SCA", "ADC"), allowNull: true });
    await queryInterface.addColumn("Invoices", "fce_acceptance", {
      type: DataTypes.ENUM("pending", "accepted", "rejected"), allowNull: true, comment: "Solo FCE emitidas. Se actualiza a mano.",
    });
    await queryInterface.addColumn("Invoices", "fce_acceptance_at", { type: DataTypes.DATE, allowNull: true });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("Invoices", "fce_acceptance_at");
    await queryInterface.removeColumn("Invoices", "fce_acceptance");
    await queryInterface.removeColumn("Invoices", "fce_transfer_option");
    await queryInterface.removeColumn("Invoices", "bank_account_id");
    await queryInterface.removeColumn("Clients", "fce_transfer_option");
  },
};
