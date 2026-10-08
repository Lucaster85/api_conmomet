"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

// Una línea por concepto de una factura. `percent` es el porcentaje del concepto del presupuesto
// que cubre esta línea (null en "other"). Las columnas base_* son una foto del bruto, el
// descuento y el neto del concepto al momento de facturar. Sin paranoid: se borran junto con la
// factura (CASCADE) y se recrean cuando se corrige la factura.
module.exports = () => {
  class InvoiceLine extends Model {
    static associate(models) {
      InvoiceLine.belongsTo(models.Invoice, { foreignKey: "invoice_id", as: "invoice" });
    }
  }
  InvoiceLine.init({
    invoice_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Invoices", key: "id" } },
    concept: { type: DataTypes.ENUM("materials", "labor", "other"), allowNull: false },
    description: { type: DataTypes.STRING(255), allowNull: true },
    percent: { type: DataTypes.DECIMAL(7, 4), allowNull: true },
    net_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    base_gross_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    base_discount_percent: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
    base_net_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
  }, {
    sequelize,
    modelName: "InvoiceLine",
    tableName: "InvoiceLines",
    timestamps: true,
    underscored: true,
  });
  return InvoiceLine;
};
