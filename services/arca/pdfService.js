// Genera el PDF de una factura emitida por ARCA y lo guarda en R2 (reusa `file_url` / `file_key` / `file_name`). Se llama al autorizar
// (emission.js) y a pedido ("Generar PDF" si no se pudo en el momento). Una falla acá NUNCA tiene que afectar a la factura: el CAE ya
// existe en ARCA, así que el PDF se puede regenerar las veces que haga falta desde los datos congelados.
const db = require("../../models");
const { uploadToR2, deleteFromR2 } = require("../../helpers/r2Storage");
const { buildPdfModel, renderInvoicePdf } = require("./invoicePdf");

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const publicFileKey = (url) => (url ? url.replace(`${process.env.STORAGE_PUBLIC_URL}/`, "") : null);

/**
 * Genera (o regenera) el PDF de una factura autorizada y lo guarda. Devuelve la factura actualizada.
 * El PDF anterior se borra solo si lo había generado el sistema (carpeta `invoices/<id>/arca/`): nunca uno que haya subido una persona.
 */
async function generateInvoicePdf(invoiceId) {
  const invoice = await db.Invoice.findByPk(invoiceId, {
    include: [
      { model: db.InvoiceLine, as: "lines" },
      { model: db.Budget, as: "budget", attributes: ["id", "number", "title"] },
    ],
  });
  if (!invoice || invoice.source !== "arca") throw fail("Factura no encontrada.", 404);
  if (invoice.arca_status !== "authorized") throw fail("El PDF se genera cuando la factura ya fue emitida en ARCA.", 409);

  const model = buildPdfModel(invoice.toJSON(), { budget: invoice.budget ? invoice.budget.toJSON() : null });
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

module.exports = { generateInvoicePdf, generateInvoicePdfSafely };
