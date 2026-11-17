"use strict";
const { DataTypes } = require("sequelize");

/**
 * Documentos extra del detalle de facturación de un presupuesto (PLAN_ARCA.md §3.6, etapa 6): adjuntos libres, por ejemplo las "facturas de pantalla" que
 * mencionó el cliente (qué son exactamente sigue siendo una pregunta abierta, §6).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("BudgetBillingFiles", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      budget_id: {
        type: DataTypes.INTEGER, allowNull: false,
        references: { model: "Budgets", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT",
      },
      description: { type: DataTypes.STRING(255), allowNull: true },
      file_url: { type: DataTypes.STRING(500), allowNull: false },
      file_key: { type: DataTypes.STRING(500), allowNull: true },
      file_name: { type: DataTypes.STRING(255), allowNull: true },
      mime_type: { type: DataTypes.STRING(120), allowNull: true },
      size_bytes: { type: DataTypes.INTEGER, allowNull: true },
      uploaded_by: {
        type: DataTypes.INTEGER, allowNull: false,
        references: { model: "Users", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT",
      },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
    });
    await queryInterface.addIndex("BudgetBillingFiles", ["budget_id"], { name: "budget_billing_files_budget_idx" });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("BudgetBillingFiles");
  },
};
