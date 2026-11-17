"use strict";
const { DataTypes } = require("sequelize");

/**
 * Emisión por ARCA (PLAN_ARCA.md §4 y §8, etapa 2). Suma a Invoices lo que hace falta para emitir y para no perder el
 * rastro de lo que ARCA devolvió:
 * - `cbte_tipo`: el código de ARCA (1 Factura A, 201 FCE A, 3 NC A…). ARCA numera por punto de venta Y TIPO de
 *   comprobante: la Factura A y la FCE A tienen numeraciones separadas. Con la clave única vieja
 *   (voucher_type, pos, number) no se podía cargar la FCE 0002-00000212 si ya existía la Factura A 0002-00000212 (B1).
 *   Las existentes se migran por su letra (A→1, B→6, C→11, E→19); las FCE cargadas a mano antes quedaron como Factura A y
 *   se corrigen a mano. `sin_factura` queda en NULL (no choca en el índice).
 * - `source` (manual / arca) y `arca_status` (manual / draft / authorizing / authorized / rejected): la máquina de estados
 *   de la emisión (B6). Las facturas ya cargadas quedan en `manual`.
 * - Receptor congelado, concepto y fechas de servicio, moneda (cotización con 6 decimales como ARCA y total en pesos),
 *   datos opcionales de la factura (condición de venta, remito, referencia comercial) y los JSON de lo que ARCA devolvió
 *   (sin Token ni Sign, S2) y de los datos del emisor y del receptor congelados al autorizar (S9).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const add = (name, definition) => queryInterface.addColumn("Invoices", name, definition);

    await add("cbte_tipo", { type: DataTypes.INTEGER, allowNull: true, comment: "Código de comprobante de ARCA. Null en sin_factura." });
    await add("source", { type: DataTypes.ENUM("manual", "arca"), allowNull: false, defaultValue: "manual" });
    await add("arca_status", {
      type: DataTypes.ENUM("manual", "draft", "authorizing", "authorized", "rejected"),
      allowNull: false, defaultValue: "manual",
    });
    await add("arca_env", { type: DataTypes.ENUM("homologacion", "produccion"), allowNull: true, comment: "Ambiente en el que se emitió." });
    await add("arca_concept", { type: DataTypes.INTEGER, allowNull: true, comment: "1 productos, 2 servicios, 3 ambos." });
    await add("service_from", { type: DataTypes.DATEONLY, allowNull: true });
    await add("service_to", { type: DataTypes.DATEONLY, allowNull: true });
    await add("recipient_doc_type", { type: DataTypes.INTEGER, allowNull: true, comment: "80 CUIT, 96 DNI, 99 consumidor final." });
    await add("recipient_doc_number", { type: DataTypes.STRING(11), allowNull: true });
    await add("recipient_vat_condition_id", { type: DataTypes.INTEGER, allowNull: true, comment: "CondicionIVAReceptorId de WSFEv1 (obligatorio desde 1/12/2026, RG 5616)." });
    await add("point_of_sale_id", {
      type: DataTypes.INTEGER, allowNull: true,
      references: { model: "CompanyPointsOfSale", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT",
    });
    await add("same_currency_payment", { type: DataTypes.BOOLEAN, allowNull: true, comment: "USD: se cobra en la misma moneda (CanMisMonExt = S)." });
    await add("total_amount_ars", { type: DataTypes.DECIMAL(14, 2), allowNull: true, comment: "Total en pesos (total × cotización) en facturas en dólares." });
    await add("sale_condition", { type: DataTypes.STRING(60), allowNull: true });
    await add("remito_number", { type: DataTypes.STRING(30), allowNull: true });
    await add("commercial_reference", { type: DataTypes.STRING(255), allowNull: true });
    await add("authorized_at", { type: DataTypes.DATE, allowNull: true });
    await add("arca_result", { type: DataTypes.JSON, allowNull: true, comment: "Respuesta de ARCA sin credenciales: resultado, CAE, observaciones y errores." });
    await add("issuer_snapshot", { type: DataTypes.JSON, allowNull: true, comment: "Datos del emisor congelados al autorizar." });
    await add("recipient_snapshot", { type: DataTypes.JSON, allowNull: true, comment: "Datos del receptor congelados al autorizar." });

    // ARCA maneja la cotización con 6 decimales.
    await queryInterface.changeColumn("Invoices", "exchange_rate", { type: DataTypes.DECIMAL(18, 6), allowNull: true });

    await queryInterface.sequelize.query(
      "UPDATE Invoices SET cbte_tipo = CASE voucher_type WHEN 'A' THEN 1 WHEN 'B' THEN 6 WHEN 'C' THEN 11 WHEN 'E' THEN 19 ELSE NULL END"
    );

    // Clave única nueva: ARCA numera por punto de venta y tipo de comprobante (B1). En MySQL los NULL no chocan.
    await queryInterface.removeIndex("Invoices", "invoices_voucher_unique");
    await queryInterface.addIndex("Invoices", ["cbte_tipo", "pos_number", "number"], { name: "invoices_cbte_unique", unique: true });
    await queryInterface.addIndex("Invoices", ["arca_status"], { name: "invoices_arca_status_idx" });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex("Invoices", "invoices_arca_status_idx");
    await queryInterface.removeIndex("Invoices", "invoices_cbte_unique");
    await queryInterface.addIndex("Invoices", ["voucher_type", "pos_number", "number"], { name: "invoices_voucher_unique", unique: true });
    await queryInterface.changeColumn("Invoices", "exchange_rate", { type: DataTypes.DECIMAL(14, 4), allowNull: true });
    for (const column of [
      "issuer_snapshot", "recipient_snapshot", "arca_result", "authorized_at", "commercial_reference", "remito_number",
      "sale_condition", "total_amount_ars", "same_currency_payment", "point_of_sale_id", "recipient_vat_condition_id",
      "recipient_doc_number", "recipient_doc_type", "service_to", "service_from", "arca_concept", "arca_env", "arca_status",
      "source", "cbte_tipo",
    ]) {
      await queryInterface.removeColumn("Invoices", column);
    }
  },
};
