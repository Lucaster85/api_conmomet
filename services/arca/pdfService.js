// Genera el PDF de una factura emitida por ARCA y lo guarda en R2 (reusa `file_url` / `file_key` / `file_name`). Se llama al autorizar
// (emission.js) y a pedido ("Generar PDF" si no se pudo en el momento). Una falla acá NUNCA tiene que afectar a la factura: el CAE ya
// existe en ARCA, así que el PDF se puede regenerar las veces que haga falta desde los datos congelados.
const db = require("../../models");
const { uploadToR2, deleteFromR2 } = require("../../helpers/r2Storage");
const { buildPdfModel, renderInvoicePdf } = require("./invoicePdf");
const fe = require("./feRequest");

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const publicFileKey = (url) => (url ? url.replace(`${process.env.STORAGE_PUBLIC_URL}/`, "") : null);

/**
 * Genera (o regenera) el PDF de una factura autorizada y lo guarda. Devuelve la factura actualizada.
 * El PDF anterior se borra solo si lo había generado el sistema (carpeta `invoices/<id>/arca/`): nunca uno que haya subido una persona.
 */
async function generateInvoicePdf(invoiceId) {
  const invoice = await db.Invoice.findByPk(invoiceId, {
    include: [
      {
        model: db.InvoiceLine, as: "lines",
        include: [
          { model: db.Budget, as: "budget", attributes: ["id", "number", "title"] },
          { model: db.ClientPurchaseOrder, as: "purchaseOrder", attributes: ["id", "number"] },
        ],
      },
      { model: db.Budget, as: "budget", attributes: ["id", "number", "title"] },
      { model: db.Invoice, as: "associatedInvoice", attributes: ["id", "cbte_tipo", "pos_number", "number", "issue_date"] },
    ],
  });
  if (!invoice || invoice.source !== "arca") throw fail("Factura no encontrada.", 404);
  if (invoice.arca_status !== "authorized") throw fail("El PDF se genera cuando la factura ya fue emitida en ARCA.", 409);

  const model = buildPdfModel(invoice.toJSON(), {
    budget: invoice.budget ? invoice.budget.toJSON() : null,
    associated: invoice.associatedInvoice ? invoice.associatedInvoice.toJSON() : null,
  });
  const buffer = await renderInvoicePdf(model);
  const fileName = `${model.fileBase}.pdf`;

  const previousUrl = invoice.file_url;
  const url = await uploadToR2({ buffer, originalname: fileName, mimetype: "application/pdf" }, `invoices/${invoice.id}/arca`);
  await invoice.update({ file_url: url, file_key: publicFileKey(url), file_name: fileName });

  if (previousUrl && previousUrl.includes(`/invoices/${invoice.id}/arca/`)) {
    deleteFromR2(previousUrl).catch(() => {});
  }
  return invoice;
}

/** Igual, pero sin tirar: para llamarlo justo después de autorizar. Devuelve true si se generó. */
async function generateInvoicePdfSafely(invoiceId) {
  try {
    await generateInvoicePdf(invoiceId);
    return true;
  } catch (error) {
    // Sin datos de la factura ni del almacenamiento en el log: solo qué falló.
    console.error(`[arca] No se pudo generar el PDF de la factura ${invoiceId}: ${error.message}`);
    return false;
  }
}

/**
 * VISTA PREVIA de un borrador (antes de emitir): el mismo PDF que saldrá, pero lo que asigna ARCA (número, CAE, vencimiento y QR) con
 * asteriscos. No guarda nada ni toca R2: devuelve el Buffer. El emisor y el receptor salen de los datos actuales de la empresa y el
 * cliente (al emitir se congelan esos mismos). Solo para borradores y rechazadas; una emitida ya tiene su PDF real.
 */
async function previewInvoicePdf(invoiceId) {
  const invoice = await db.Invoice.findByPk(invoiceId, {
    include: [
      {
        model: db.InvoiceLine, as: "lines",
        include: [
          { model: db.Budget, as: "budget", attributes: ["id", "number", "title"] },
          { model: db.ClientPurchaseOrder, as: "purchaseOrder", attributes: ["id", "number"] },
        ],
      },
      { model: db.Budget, as: "budget", attributes: ["id", "number", "title"] },
      { model: db.Invoice, as: "associatedInvoice", attributes: ["id", "cbte_tipo", "pos_number", "number", "issue_date"] },
    ],
  });
  if (!invoice || invoice.source !== "arca") throw fail("Factura no encontrada.", 404);
  if (invoice.arca_status === "authorized" || invoice.arca_status === "authorizing") {
    throw fail("La vista previa es para facturas que todavía no se emitieron.", 409);
  }

  const [client, pointOfSale, company, bankAccount] = await Promise.all([
    db.Client.findByPk(invoice.client_id),
    invoice.point_of_sale_id ? db.CompanyPointOfSale.findByPk(invoice.point_of_sale_id) : null,
    db.CompanyProfile.findByPk(1),
    invoice.bank_account_id ? db.CompanyBankAccount.findByPk(invoice.bank_account_id) : null,
  ]);
  if (!client) throw fail("La factura no tiene cliente.", 409);
  if (!pointOfSale) throw fail("La factura no tiene punto de venta.", 409);
  if (!company) throw fail("Faltan los datos de la empresa emisora.", 409);

  const json = invoice.toJSON();
  json.issuer_snapshot = fe.buildIssuerSnapshot(company, pointOfSale, fe.isFceInvoice(invoice.cbte_tipo) ? bankAccount : null);
  json.recipient_snapshot = fe.buildRecipientSnapshot(client, invoice);
  if (json.pos_number == null) json.pos_number = pointOfSale.number;

  const model = buildPdfModel(json, {
    preview: true,
    budget: invoice.budget ? invoice.budget.toJSON() : null,
    associated: invoice.associatedInvoice ? invoice.associatedInvoice.toJSON() : null,
  });
  return { buffer: await renderInvoicePdf(model), fileName: `${model.fileBase}.pdf` };
}

module.exports = { generateInvoicePdf, generateInvoicePdfSafely, previewInvoicePdf };
