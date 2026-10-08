"use strict";
const { DataTypes } = require("sequelize");

/**
 * Líneas de una factura, una por concepto (materiales, mano de obra u "otro"). Se borran junto
 * con su factura (CASCADE) — la factura en sí nunca se borra, se anula. Las columnas base_* son
 * una FOTO del bruto, el descuento y el neto del concepto al momento de facturar: sirven para
 * auditar contra qué base se calculó el porcentaje.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("InvoiceLines", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      invoice_id: {
        type: DataTypes.INTEGER, allowNull: false,
        references: { model: "Invoices", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE",
      },
      concept: { type: DataTypes.ENUM("materials", "labor", "other"), allowNull: false, comment: "other solo en factura libre." },
      description: { type: DataTypes.STRING(255), allowNull: true },
      percent: { type: DataTypes.DECIMAL(7, 4), allowNull: true, comment: "Porcentaje del concepto que factura esta línea. Null en other." },
      net_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
      base_gross_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
      base_discount_percent: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
      base_net_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("InvoiceLines", ["invoice_id"], { name: "invoice_lines_invoice_idx" });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("InvoiceLines");
  },
};
