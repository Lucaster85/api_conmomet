"use strict";
const { DataTypes } = require("sequelize");

/**
 * Seguros de caución (PLAN_ARCA.md §3.5, etapa 6). Asociados al presupuesto, con OC opcional. Bunge, por ejemplo, exige una póliza de caución por el
 * anticipo financiero y la acepta SIN fecha de vencimiento: por eso `expiration_date` es opcional, y solo las cauciones con vencimiento entran al
 * barrido de avisos. `released_at` (devolución de la póliza) las saca del aviso: sin eso, una póliza ya devuelta avisaría "vencida" para siempre.
 * Una póliza lleva UN archivo (el PDF), en las columnas file_*.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("SuretyBonds", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      budget_id: {
        type: DataTypes.INTEGER, allowNull: false,
        references: { model: "Budgets", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT",
      },
      purchase_order_id: {
        type: DataTypes.INTEGER, allowNull: true,
        references: { model: "ClientPurchaseOrders", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT",
      },
      insurer: { type: DataTypes.STRING(150), allowNull: false, comment: "Aseguradora." },
      policy_number: { type: DataTypes.STRING(80), allowNull: false },
      amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
      currency: { type: DataTypes.ENUM("ARS", "USD"), allowNull: false },
      issue_date: { type: DataTypes.DATEONLY, allowNull: true },
      purpose: { type: DataTypes.ENUM("advance_payment", "other"), allowNull: false, defaultValue: "advance_payment" },
      expiration_date: { type: DataTypes.DATEONLY, allowNull: true, comment: "Opcional: hay pólizas sin vencimiento." },
      notify_days_before: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 30 },
      released_at: { type: DataTypes.DATEONLY, allowNull: true, comment: "Fecha en que se devolvió la póliza: deja de avisar." },
      notes: { type: DataTypes.TEXT, allowNull: true },
      file_url: { type: DataTypes.STRING(500), allowNull: true },
      file_key: { type: DataTypes.STRING(500), allowNull: true },
      file_name: { type: DataTypes.STRING(255), allowNull: true },
      mime_type: { type: DataTypes.STRING(120), allowNull: true },
      size_bytes: { type: DataTypes.INTEGER, allowNull: true },
      created_by: {
        type: DataTypes.INTEGER, allowNull: false,
        references: { model: "Users", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT",
      },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
    });
    await queryInterface.addIndex("SuretyBonds", ["budget_id"], { name: "surety_bonds_budget_idx" });
    await queryInterface.addIndex("SuretyBonds", ["expiration_date"], { name: "surety_bonds_expiration_idx" });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("SuretyBonds");
  },
};
