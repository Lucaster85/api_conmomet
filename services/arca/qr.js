// Código QR de la factura (RG 4892 de ARCA). El QR lleva una URL del verificador de ARCA con los datos del comprobante en un
// JSON codificado en base64: quien lo escanea ve en ARCA si el CAE corresponde a ese comprobante. Pura: sin red ni base.
const { round2 } = require("./feRequest");
const { DOC_TIPO } = require("./codes");

const QR_BASE_URL = "https://www.afip.gob.ar/fe/qr/";

/**
 * Datos del QR. `importe` y `ctz` van en la moneda del comprobante (en dólares, `ctz` es la cotización en pesos).
 * `tipoCodAut` "E" = CAE. Los números van como número (no string), como pide la especificación.
 */
function buildQrPayload({ invoice, issuerCuit }) {
  const isUsd = invoice.currency === "USD";
  return {
    ver: 1,
    fecha: String(invoice.issue_date).slice(0, 10),
    cuit: Number(issuerCuit),
    ptoVta: Number(invoice.pos_number),
    tipoCmp: Number(invoice.cbte_tipo),
    nroCmp: Number(invoice.number),
    importe: round2(invoice.total_amount),
    moneda: isUsd ? "DOL" : "PES",
    ctz: isUsd ? Number(Number(invoice.exchange_rate).toFixed(6)) : 1,
    tipoDocRec: Number(invoice.recipient_doc_type || DOC_TIPO.CUIT),
    nroDocRec: Number(invoice.recipient_doc_number),
    tipoCodAut: "E",
    codAut: Number(invoice.cae),
  };
}

function buildQrUrl(payload) {
  return `${QR_BASE_URL}?p=${Buffer.from(JSON.stringify(payload), "utf8").toString("base64")}`;
}

/** Inversa de buildQrUrl, para tests y diagnóstico: lee el JSON que lleva una URL de QR. */
function parseQrUrl(url) {
  const encoded = new URL(url).searchParams.get("p");
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

module.exports = { buildQrPayload, buildQrUrl, parseQrUrl, QR_BASE_URL };
