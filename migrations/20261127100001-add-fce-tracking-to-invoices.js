"use strict";
const { DataTypes } = require("sequelize");

/**
 * Seguimiento de FCE con ARCA (wsfecred, FLOWS.md §77): el estado de cada FCE y de su cuenta corriente se guarda TAL CUAL lo da ARCA, y `fce_acceptance` pasa a derivarse de ahí.
 * - Invoices.fce_cmp_state: estado del comprobante (factura, ND o NC). fce_account_state / fce_account_code: cuenta corriente de la factura.
 * - fce_acceptance_type (Tácita/Expresa), fce_available_at, fce_acceptance_due (hasta cuándo puede aceptarla el cliente), fce_rejection_reasons, fce_balance y fce_accepted_balance.
 * - fce_synced_at: última sincronización de esa factura. fce_arca_snapshot: último comprobante de ARCA, saneado (CBU enmascarado), para diagnosticar sin volver a llamar.
 * - SystemSettings.last_fce_sync_at: última sincronización general (se muestra en pantalla y hace de turno atómico contra dos sincronizaciones a la vez).
 */

const CMP_STATES = ["PendienteRecepcion", "Recepcionado", "Aceptado", "Rechazado", "InformadaAgDpto"];
const ACCOUNT_STATES = ["Modificable", "Aceptada", "Rechazada", "CanceladaTotal", "InformadaAgDpto"];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("Invoices", "fce_cmp_state", { type: DataTypes.ENUM(...CMP_STATES), allowNull: true });
    await queryInterface.addColumn("Invoices", "fce_account_state", { type: DataTypes.ENUM(...ACCOUNT_STATES), allowNull: true });
    await queryInterface.addColumn("Invoices", "fce_account_code", { type: DataTypes.BIGINT, allowNull: true });
    await queryInterface.addColumn("Invoices", "fce_acceptance_type", { type: DataTypes.ENUM("Tacita", "Expresa"), allowNull: true });
    await queryInterface.addColumn("Invoices", "fce_available_at", { type: DataTypes.DATEONLY, allowNull: true });
    await queryInterface.addColumn("Invoices", "fce_acceptance_due", { type: DataTypes.DATEONLY, allowNull: true });
    await queryInterface.addColumn("Invoices", "fce_rejection_reasons", { type: DataTypes.JSON, allowNull: true });
    await queryInterface.addColumn("Invoices", "fce_balance", { type: DataTypes.DECIMAL(14, 2), allowNull: true });
    await queryInterface.addColumn("Invoices", "fce_accepted_balance", { type: DataTypes.DECIMAL(14, 2), allowNull: true });
    await queryInterface.addColumn("Invoices", "fce_synced_at", { type: DataTypes.DATE, allowNull: true });
    await queryInterface.addColumn("Invoices", "fce_arca_snapshot", { type: DataTypes.JSON, allowNull: true });
    await queryInterface.addColumn("SystemSettings", "last_fce_sync_at", { type: DataTypes.DATE, allowNull: true });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("SystemSettings", "last_fce_sync_at");
    for (const column of ["fce_arca_snapshot", "fce_synced_at", "fce_accepted_balance", "fce_balance", "fce_rejection_reasons", "fce_acceptance_due", "fce_available_at", "fce_acceptance_type", "fce_account_code", "fce_account_state", "fce_cmp_state"]) {
      await queryInterface.removeColumn("Invoices", column);
    }
  },
};
