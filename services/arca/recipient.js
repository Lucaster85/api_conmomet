// Receptor de una factura por ARCA. Casi siempre es un cliente cargado (`client_id`); en una factura LIBRE a un cliente ocasional (la venta de un vehículo de la
// empresa, por ejemplo) los datos se escribieron a mano y viven en `Invoices.manual_recipient`. Para que todo lo demás (validación de la emisión, snapshot del
// receptor, PDF) no tenga que distinguirlos, el receptor manual se presenta con la forma de un Client.
const db = require("../../models");

/** Un Client "virtual" a partir de los datos escritos a mano. null si no hay. */
function manualRecipientAsClient(manual) {
  if (!manual) return null;
  return {
    id: null,
    razonSocial: manual.legal_name,
    cuit: manual.cuit,
    tax_condition: manual.tax_condition,
    fiscal_street: manual.fiscal_street || null,
    fiscal_locality: manual.fiscal_locality || null,
    fiscal_province: manual.fiscal_province || null,
    fce_transfer_option: null,
  };
}

/** El receptor de la factura: el cliente cargado o el manual (con forma de Client). null si no tiene ninguno. */
async function loadRecipient(invoice, { transaction } = {}) {
  if (invoice.client_id) return db.Client.findByPk(invoice.client_id, { transaction });
  return manualRecipientAsClient(invoice.manual_recipient);
}

module.exports = { manualRecipientAsClient, loadRecipient };
