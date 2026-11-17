// PDF de la factura (PLAN_ARCA.md §1b y etapa 3). Se genera en el backend, SOLO desde los datos congelados al autorizar
// (`issuer_snapshot` y `recipient_snapshot`, S9): editar después el cliente o la empresa no cambia una factura emitida.
// Replica el formato del PDF de ARCA: encabezado con emisor y letra/código, bloque del receptor, líneas (código, descripción,
// cantidad, unidad, precio, bonificación, subtotal, alícuota y subtotal con IVA), totales, CAE y QR, en tres copias
// (ORIGINAL, DUPLICADO, TRIPLICADO). En homologación lleva la marca "HOMOLOGACIÓN – SIN VALIDEZ FISCAL" (S4).
//
// Dos partes: `buildPdfModel` (pura: arma los textos ya formateados) y `renderInvoicePdf` (pdfkit: los dibuja).
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const { CBTE_TIPO_LABELS } = require("./codes");
const { buildQrPayload, buildQrUrl } = require("./qr");
const { round2 } = require("./feRequest");
const { formatCuit } = require("../../helpers/cuit");

const VAT_LABELS = { responsable_inscripto: "IVA Responsable Inscripto", monotributo: "Responsable Monotributo", exento: "IVA Sujeto Exento" };
const CONCEPT_LABELS = { materials: "materiales", labor: "mano de obra", other: "otros conceptos" };
const COPIES = ["ORIGINAL", "DUPLICADO", "TRIPLICADO"];
const TEST_WATERMARK = "HOMOLOGACIÓN – SIN VALIDEZ FISCAL";

// Título de cada tipo de comprobante en el encabezado.
const KIND_TITLES = {
  1: "FACTURA", 2: "NOTA DE DÉBITO", 3: "NOTA DE CRÉDITO",
  201: "FACTURA DE CRÉDITO ELECTRÓNICA", 202: "NOTA DE DÉBITO ELECTRÓNICA", 203: "NOTA DE CRÉDITO ELECTRÓNICA",
};

const pad = (n, size) => String(n).padStart(size, "0");
const money = (n) => Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rate6 = (n) => Number(n).toLocaleString("es-AR", { minimumFractionDigits: 6, maximumFractionDigits: 6 });
const percent = (n) => `${Number(n).toLocaleString("es-AR", { maximumFractionDigits: 2 })}%`;
const date = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ? String(iso) : "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};
const joinParts = (parts) => parts.filter(Boolean).join(", ");

/** Descripción de una línea: la que cargó el usuario o, si no hay, una por defecto con el concepto, el % y el presupuesto. */
function lineDescription(line, budget) {
  if (line.description && String(line.description).trim()) return String(line.description).trim();
  const concept = CONCEPT_LABELS[line.concept] || "";
  const pct = line.percent != null ? `Se factura el ${Number(line.percent).toLocaleString("es-AR", { maximumFractionDigits: 4 })}% de ${concept}` : `Se factura ${concept}`;
  const ref = budget ? [budget.number, budget.title].filter(Boolean).join(" ") : "";
  return ref ? `${pct} — ${ref}` : pct;
}

/**
 * Arma el modelo del PDF (textos ya formateados) desde una factura autorizada en JSON plano.
 * @param {object} invoice factura con `lines`, `issuer_snapshot`, `recipient_snapshot`, `cae`, `arca_env`…
 * @param {object} [extra] { budget: { number, title } }
 */
function buildPdfModel(invoice, extra = {}) {
  const issuer = invoice.issuer_snapshot;
  const recipient = invoice.recipient_snapshot;
  if (!issuer || !recipient || !invoice.cae || !invoice.number) {
    throw new Error("La factura no está autorizada o le faltan los datos congelados del emisor y el receptor.");
  }
  const isUsd = invoice.currency === "USD";
  const cbteTipo = Number(invoice.cbte_tipo);
  const rate = Number(invoice.iva_rate);
  const code = cbteTipo >= 100 ? pad(cbteTipo, 3) : pad(cbteTipo, 2);
  const qrUrl = buildQrUrl(buildQrPayload({ invoice, issuerCuit: issuer.cuit }));

  const rows = (invoice.lines || []).map((line) => {
    const net = Number(line.net_amount);
    return {
      code: "",
      description: lineDescription(line, extra.budget),
      quantity: money(1),
      unit: "otras unidades",
      unitPrice: money(net),
      bonus: money(0),
      subtotal: money(net),
      iva: percent(rate),
      // Solo visual (B11): lo que valida ARCA es el total, que sale de neto + IVA sobre la base total, no de la suma de estas filas.
      subtotalWithIva: money(round2(net * (1 + rate / 100))),
    };
  });

  const pesosTotal = isUsd ? round2(Number(invoice.total_amount) * Number(invoice.exchange_rate)) : null;
  const addressOf = (a) => joinParts([a && a.street, a && a.number, a && a.locality, a && a.province]);

  return {
    isTest: invoice.arca_env === "homologacion",
    watermark: TEST_WATERMARK,
    copies: COPIES,
    title: KIND_TITLES[cbteTipo] || (CBTE_TIPO_LABELS[cbteTipo] || "COMPROBANTE").toUpperCase(),
    letter: "A",
    codeLabel: `COD. ${code}`,
    fileBase: `${(CBTE_TIPO_LABELS[cbteTipo] || "Comprobante").replace(/\s+/g, "-")}-${pad(invoice.pos_number, 4)}-${pad(invoice.number, 8)}`,
    pos: pad(invoice.pos_number, 4),
    number: pad(invoice.number, 8),
    issueDate: date(invoice.issue_date),
    issuer: {
      displayName: issuer.display_name || issuer.legal_name,
      legalName: issuer.legal_name,
      address: addressOf(issuer.address),
      vat: VAT_LABELS[issuer.vat_condition] || issuer.vat_condition || "",
      cuit: String(issuer.cuit || ""),
      iibb: issuer.iibb_number || "",
      activityStart: date(issuer.activity_start_date),
    },
    recipient: {
      cuit: formatCuit(recipient.cuit) || "",
      legalName: recipient.legal_name,
      vat: recipient.vat_condition || "",
      address: addressOf(recipient.address),
      saleCondition: invoice.sale_condition || "",
      remito: invoice.remito_number || "",
    },
    period: invoice.arca_concept && Number(invoice.arca_concept) !== 1
      ? { from: date(invoice.service_from), to: date(invoice.service_to), due: date(invoice.due_date) }
      : null,
    currencyLine: isUsd ? `Moneda: USD – Dólar Estadounidense    Tipo de cambio: ${rate6(invoice.exchange_rate)}` : null,
    amountSuffix: isUsd ? " (USD)" : "",
    rows,
    commercialReference: invoice.commercial_reference || "",
    totals: {
      net: money(invoice.net_amount),
      ivaLabel: `IVA ${percent(rate)}`,
      iva: money(invoice.iva_amount),
      other: money(0),
      total: money(invoice.total_amount),
    },
    pesosLegend: isUsd
      ? `Total expresado en pesos considerando un tipo de cambio de ${rate6(invoice.exchange_rate)} asciende a $ ${money(pesosTotal)}`
      : null,
    cae: String(invoice.cae),
    caeExpiration: date(invoice.cae_expiration),
    qrUrl,
  };
}

// --- Dibujo ---
const PAGE = { w: 595.28, h: 841.89, margin: 28 };
const CONTENT_W = PAGE.w - PAGE.margin * 2;
const COLS = [
  { key: "code", label: "Código", w: 30, align: "left" },
  { key: "description", label: "Producto / Servicio", w: 144, align: "left" },
  { key: "quantity", label: "Cantidad", w: 42, align: "right" },
  { key: "unit", label: "U. Medida", w: 50, align: "left" },
  { key: "unitPrice", label: "Precio Unit.", w: 62, align: "right" },
  { key: "bonus", label: "% Bonif", w: 34, align: "right" },
  { key: "subtotal", label: "Subtotal", w: 62, align: "right" },
  { key: "iva", label: "Alíc. IVA", w: 30, align: "right" },
  { key: "subtotalWithIva", label: "Subtotal c/IVA", w: 85, align: "right" },
];
const FOOTER_TOP = 690;
const GREY = "#E6E6E6";

function drawWatermark(doc, model) {
  doc.save();
  doc.rotate(-35, { origin: [PAGE.w / 2, PAGE.h / 2] });
  doc.fillColor("#CC0000").fillOpacity(0.13).font("Helvetica-Bold").fontSize(40);
  doc.text(model.watermark, 0, PAGE.h / 2 - 20, { width: PAGE.w, align: "center", lineBreak: false });
  doc.restore();
  doc.fillOpacity(1).fillColor("black");
}

function drawHeader(doc, model, copy) {
  const m = PAGE.margin;
  // Copia.
  doc.font("Helvetica-Bold").fontSize(11).fillColor("black");
  doc.rect(PAGE.w / 2 - 70, 22, 140, 18).stroke();
  doc.text(copy, PAGE.w / 2 - 70, 26, { width: 140, align: "center", lineBreak: false });

  const top = 44;
  const height = 106;
  doc.rect(m, top, CONTENT_W, height).stroke();
  const mid = PAGE.w / 2;
  doc.moveTo(mid, top + 40).lineTo(mid, top + height).stroke();
  // Letra y código.
  doc.rect(mid - 20, top, 40, 40).fillAndStroke("white", "black");
  doc.fillColor("black").font("Helvetica-Bold").fontSize(26).text(model.letter, mid - 20, top + 3, { width: 40, align: "center", lineBreak: false });
  doc.font("Helvetica").fontSize(7).text(model.codeLabel, mid - 20, top + 31, { width: 40, align: "center", lineBreak: false });

  // Emisor (izquierda).
  const leftW = mid - m - 30;
  doc.font("Helvetica-Bold").fontSize(14).text(model.issuer.displayName, m + 8, top + 8, { width: leftW });
  doc.font("Helvetica").fontSize(8.5);
  doc.text(`Razón Social: ${model.issuer.legalName}`, m + 8, top + 48, { width: leftW });
  doc.text(`Domicilio Comercial: ${model.issuer.address}`, m + 8, top + 61, { width: leftW });
  doc.text(`Condición frente al IVA: ${model.issuer.vat}`, m + 8, top + 86, { width: leftW });

  // Comprobante (derecha).
  const rightX = mid + 28;
  const rightW = PAGE.w - m - rightX - 6;
  doc.font("Helvetica-Bold").fontSize(15).text(model.title, rightX, top + 6, { width: rightW });
  doc.fontSize(9.5).text(`Punto de Venta: ${model.pos}     Comp. Nro: ${model.number}`, rightX, top + 40, { width: rightW });
  doc.text(`Fecha de Emisión: ${model.issueDate}`, rightX, top + 54, { width: rightW });
  doc.font("Helvetica").fontSize(8.5);
  doc.text(`CUIT: ${model.issuer.cuit}`, rightX, top + 70, { width: rightW });
  doc.text(`Ingresos Brutos: ${model.issuer.iibb}`, rightX, top + 82, { width: rightW });
  doc.text(`Fecha de Inicio de Actividades: ${model.issuer.activityStart}`, rightX, top + 94, { width: rightW });
  return top + height + 6;
}

function drawBlocks(doc, model, y) {
  const m = PAGE.margin;
  if (model.period) {
    doc.rect(m, y, CONTENT_W, 18).stroke();
    doc.font("Helvetica-Bold").fontSize(8.5).text(
      `Período Facturado Desde: ${model.period.from}      Hasta: ${model.period.to}      Fecha de Vto. para el pago: ${model.period.due}`,
      m + 8, y + 5, { width: CONTENT_W - 16, lineBreak: false }
    );
    y += 24;
  }

  const r = model.recipient;
  const lines = [
    [`CUIT: ${r.cuit}`, `Apellido y Nombre / Razón Social: ${r.legalName}`],
    [`Condición frente al IVA: ${r.vat}`, `Domicilio Comercial: ${r.address}`],
    [`Condición de venta: ${r.saleCondition}`, `Remito: ${r.remito}`],
  ];
  const boxH = 6 + lines.length * 14 + 4;
  doc.rect(m, y, CONTENT_W, boxH).stroke();
  doc.font("Helvetica").fontSize(8.5);
  lines.forEach(([left, right], i) => {
    doc.text(left, m + 8, y + 6 + i * 14, { width: 200, lineBreak: false });
    doc.text(right, m + 215, y + 6 + i * 14, { width: CONTENT_W - 223, lineBreak: false });
  });
  y += boxH + 4;

  if (model.currencyLine) {
    doc.font("Helvetica-Bold").fontSize(8.5).text(model.currencyLine, m, y + 2, { width: CONTENT_W, lineBreak: false });
    y += 16;
  }
  return y + 2;
}

function drawTableHeader(doc, model, y) {
  const m = PAGE.margin;
  doc.rect(m, y, CONTENT_W, 22).fillAndStroke(GREY, "black");
  doc.fillColor("black").font("Helvetica-Bold").fontSize(7.5);
  let x = m;
  for (const col of COLS) {
    const label = ["unitPrice", "subtotal", "subtotalWithIva"].includes(col.key) ? `${col.label}${model.amountSuffix}` : col.label;
    doc.text(label, x + 2, y + 4, { width: col.w - 4, align: col.align });
    x += col.w;
  }
  return y + 26;
}

function drawRow(doc, row, y) {
  const m = PAGE.margin;
  doc.font("Helvetica").fontSize(8);
  const descHeight = doc.heightOfString(row.description, { width: COLS[1].w - 4 });
  const height = Math.max(16, descHeight + 6);
  let x = m;
  for (const col of COLS) {
    doc.text(row[col.key], x + 2, y + 2, { width: col.w - 4, align: col.align });
    x += col.w;
  }
  doc.moveTo(m, y + height).lineTo(m + CONTENT_W, y + height).strokeColor("#BBBBBB").stroke().strokeColor("black");
  return y + height;
}

function rowHeight(doc, row) {
  doc.font("Helvetica").fontSize(8);
  return Math.max(16, doc.heightOfString(row.description, { width: COLS[1].w - 4 }) + 6);
}

function drawTotals(doc, model, y) {
  const m = PAGE.margin;
  const boxW = 230;
  const x = m + CONTENT_W - boxW;
  const items = [
    [`Importe Neto Gravado${model.amountSuffix}:`, model.totals.net],
    [`${model.totals.ivaLabel}${model.amountSuffix}:`, model.totals.iva],
    [`Importe Otros Tributos${model.amountSuffix}:`, model.totals.other],
  ];
  doc.font("Helvetica").fontSize(9);
  items.forEach(([label, value], i) => {
    doc.text(label, x, y + i * 14, { width: boxW - 90, align: "right", lineBreak: false });
    doc.text(value, x + boxW - 85, y + i * 14, { width: 85, align: "right", lineBreak: false });
  });
  const totalY = y + items.length * 14 + 2;
  doc.font("Helvetica-Bold").fontSize(10.5);
  doc.text(`Importe Total${model.amountSuffix}:`, x, totalY, { width: boxW - 90, align: "right", lineBreak: false });
  doc.text(model.totals.total, x + boxW - 85, totalY, { width: 85, align: "right", lineBreak: false });
  let end = totalY + 18;
  if (model.pesosLegend) {
    doc.font("Helvetica").fontSize(8.5).text(model.pesosLegend, m, end + 4, { width: CONTENT_W, align: "right" });
    end += 24;
  }
  return end;
}

function drawFooter(doc, model, qrPng) {
  const m = PAGE.margin;
  doc.moveTo(m, FOOTER_TOP).lineTo(m + CONTENT_W, FOOTER_TOP).stroke();
  doc.image(qrPng, m, FOOTER_TOP + 8, { width: 92 });
  doc.font("Helvetica-Bold").fontSize(9).text("Comprobante Autorizado", m + 104, FOOTER_TOP + 14, { lineBreak: false });
  doc.font("Helvetica").fontSize(8.5);
  doc.text(`CAE N°: ${model.cae}`, PAGE.w - m - 230, FOOTER_TOP + 14, { width: 230, align: "right", lineBreak: false });
  doc.text(`Fecha de Vto. de CAE: ${model.caeExpiration}`, PAGE.w - m - 230, FOOTER_TOP + 28, { width: 230, align: "right", lineBreak: false });
  doc.fontSize(7).fillColor("#555555").text(
    "Esta Administración Federal no se responsabiliza por los datos ingresados en el detalle de la operación.",
    m + 104, FOOTER_TOP + 80, { width: CONTENT_W - 104, lineBreak: false }
  );
  doc.fillColor("black");
  if (model.isTest) {
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#CC0000").text(
      `${model.watermark} — comprobante emitido en el ambiente de pruebas de ARCA`,
      m, FOOTER_TOP + 108, { width: CONTENT_W, align: "center", lineBreak: false }
    );
    doc.fillColor("black");
  }
}

/**
 * Dibuja el PDF. Devuelve un Buffer. `compress: false` solo para depurar o testear la estructura.
 * @param {object} model resultado de buildPdfModel
 */
async function renderInvoicePdf(model, { compress = true } = {}) {
  const qrPng = await QRCode.toBuffer(model.qrUrl, { errorCorrectionLevel: "M", margin: 1, width: 280 });
  const doc = new PDFDocument({
    size: "A4", margin: PAGE.margin, compress, autoFirstPage: false,
    info: { Title: model.fileBase, Author: model.issuer.legalName, Subject: `${model.title} ${model.pos}-${model.number}` },
  });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const finished = new Promise((resolve, reject) => { doc.on("end", resolve); doc.on("error", reject); });

  for (const copy of model.copies) {
    doc.addPage();
    if (model.isTest) drawWatermark(doc, model);
    let y = drawHeader(doc, model, copy);
    y = drawBlocks(doc, model, y);
    y = drawTableHeader(doc, model, y);

    for (const row of model.rows) {
      // Si la fila no entra antes del pie, sigue en otra hoja de la misma copia (con el encabezado de la tabla repetido).
      if (y + rowHeight(doc, row) > FOOTER_TOP - 70) {
        drawFooter(doc, model, qrPng);
        doc.addPage();
        if (model.isTest) drawWatermark(doc, model);
        y = drawTableHeader(doc, model, 40);
      }
      y = drawRow(doc, row, y);
    }

    if (model.commercialReference) {
      doc.font("Helvetica").fontSize(8.5).text(`Referencia comercial: ${model.commercialReference}`, PAGE.margin, y + 6, { width: CONTENT_W });
      y += 24;
    }
    // Los totales ocupan ~115 pt (con la leyenda en pesos): si no entran arriba del pie, van en otra hoja. En una factura corta
    // quedan pegados al pie, como en el PDF de ARCA.
    const TOTALS_HEIGHT = 125;
    if (y + 12 + TOTALS_HEIGHT > FOOTER_TOP) { drawFooter(doc, model, qrPng); doc.addPage(); if (model.isTest) drawWatermark(doc, model); y = 40; }
    drawTotals(doc, model, Math.max(y + 12, FOOTER_TOP - TOTALS_HEIGHT));
    drawFooter(doc, model, qrPng);
  }

  doc.end();
  await finished;
  return Buffer.concat(chunks);
}

module.exports = { buildPdfModel, renderInvoicePdf, lineDescription, COPIES, TEST_WATERMARK };
