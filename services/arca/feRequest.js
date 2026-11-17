// Parte pura de la emisión (sin base de datos ni red): armado del pedido a FECAESolicitar, lectura de la respuesta y las
// validaciones que conviene hacer ANTES de llamar a ARCA (PLAN_ARCA.md §8, B3 y B11). Se testea sin SOAP.
const { CBTE_TIPO, CBTE_TIPO_LABELS, DOC_TIPO, CONCEPTO, IVA_ID, RECEIVER_VAT_CONDITIONS_CLASS_A, CLIENT_TAX_CONDITION_TO_ARCA } = require("./codes");
const { isValidCuit, normalizeCuit } = require("../../helpers/cuit");

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const pad = (n, size) => String(n).padStart(size, "0");

// "2026-11-16" -> "20261116" (formato de fechas de WSFEv1).
const toArcaDate = (iso) => String(iso).slice(0, 10).replace(/-/g, "");
// "20261116" -> "2026-11-16". Vacío -> null.
const fromArcaDate = (value) => {
  const v = value === undefined || value === null ? "" : String(value).trim();
  return /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : null;
};

// Días entre dos fechas YYYY-MM-DD (b - a), sin depender de la zona horaria.
function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

const voucherLabel = (cbteTipo, pos, number) =>
  `${CBTE_TIPO_LABELS[cbteTipo] || `Comprobante ${cbteTipo}`} ${pad(pos, 4)}-${pad(number, 8)}`;

/**
 * Lo que ARCA rechaza por fecha, validado antes de enviar (B3). Con productos la fecha del comprobante puede estar hasta 5
 * días antes o después de hoy; con servicios (o productos y servicios), hasta 10. "Hoy" es el de Argentina (Railway corre
 * en UTC: pasadas las 21 hs el UTC ya es mañana).
 */
function checkIssueDate(issueDate, concept, today) {
  const window = concept === CONCEPTO.PRODUCTOS ? 5 : 10;
  const diff = daysBetween(today, issueDate);
  if (Math.abs(diff) > window) {
    return `La fecha de emisión tiene que estar dentro de ${window} días de hoy (ARCA ${concept === CONCEPTO.PRODUCTOS ? "con productos" : "con servicios"}).`;
  }
  return null;
}

/**
 * Chequeos previos a emitir. Devuelve una lista de problemas en lenguaje claro (vacía = se puede emitir). Los que ARCA
 * rechazaría igual se frenan acá para no gastar un intento ni dejar una factura "rechazada".
 *
 * @param {object} p
 * @param {object} p.invoice plain: cbte_tipo, issue_date, due_date, currency, exchange_rate, same_currency_payment, arca_concept,
 *   service_from, service_to, recipient_vat_condition_id, iva_rate, net_amount, iva_amount, total_amount, lines
 * @param {object} p.client { cuit, tax_condition }
 * @param {object|null} p.pointOfSale { number, type, is_active }
 * @param {object|null} p.company perfil del emisor
 * @param {object} p.config getArcaConfig()
 * @param {string} p.today YYYY-MM-DD (Argentina)
 */
function validateEmission({ invoice, client, pointOfSale, company, config, today }) {
  const problems = [];

  if (!config || !config.enabled) {
    problems.push(config && config.error ? config.error : "La integración con ARCA está apagada en este servidor.");
    return problems;
  }

  if (Number(invoice.cbte_tipo) !== CBTE_TIPO.FACTURA_A) {
    problems.push("Por ahora la app solo emite Factura A por ARCA.");
  }

  if (!pointOfSale) problems.push("Elegí el punto de venta.");
  else if (pointOfSale.type !== "web_service") problems.push("El punto de venta elegido es de Comprobantes en línea: solo se puede usar para cargar facturas a mano.");
  else if (!pointOfSale.is_active) problems.push("El punto de venta elegido está inactivo.");

  // Emisor completo: es lo que se congela en la factura y sale en el PDF.
  const missing = [];
  if (!company || !company.legal_name) missing.push("razón social");
  if (!company || !isValidCuit(company.cuit)) missing.push("CUIT válido");
  if (!company || !company.address_street || !company.address_locality || !company.address_province) missing.push("domicilio comercial");
  if (missing.length) problems.push(`Completá los datos de la empresa en Configuración → Datos de mi empresa (falta: ${missing.join(", ")}).`);
  if (company && company.vat_condition !== "responsable_inscripto") {
    problems.push("Para emitir Factura A la empresa tiene que ser Responsable Inscripto (Datos de mi empresa).");
  }
  // En producción el CUIT de la conexión tiene que ser el de la empresa; en homologación solo es esperable que difiera.
  if (company && config.env === "produccion" && normalizeCuit(company.cuit) !== config.cuit) {
    problems.push("El CUIT de la conexión con ARCA no coincide con el de los datos de la empresa: en producción no se puede emitir.");
  }

  // Receptor.
  if (!client || !isValidCuit(client.cuit)) problems.push("El cliente necesita un CUIT válido para recibir una Factura A (completalo en Clientes).");
  const vatId = Number(invoice.recipient_vat_condition_id);
  if (!RECEIVER_VAT_CONDITIONS_CLASS_A[vatId]) {
    problems.push(
      client && client.tax_condition && !CLIENT_TAX_CONDITION_TO_ARCA[client.tax_condition]
        ? "La condición de IVA del cliente no admite Factura A (solo Responsable Inscripto o Monotributo)."
        : "El cliente necesita una condición frente al IVA válida para Factura A (Responsable Inscripto o Monotributo)."
    );
  }

  // Concepto y fechas.
  const concept = Number(invoice.arca_concept);
  if (![1, 2, 3].includes(concept)) {
    problems.push("Indicá el concepto (productos, servicios o ambos).");
  } else {
    const dateProblem = invoice.issue_date ? checkIssueDate(invoice.issue_date, concept, today) : "La fecha de emisión es obligatoria.";
    if (dateProblem) problems.push(dateProblem);
    if (concept !== CONCEPTO.PRODUCTOS) {
      if (!invoice.service_from || !invoice.service_to) problems.push("Con servicios hay que indicar el período facturado (desde y hasta).");
      else if (invoice.service_from > invoice.service_to) problems.push("El período facturado es inválido: la fecha desde es posterior a la fecha hasta.");
      if (!invoice.due_date) problems.push("Con servicios hay que indicar el vencimiento de pago.");
      else if (invoice.issue_date && invoice.due_date < invoice.issue_date) problems.push("El vencimiento de pago no puede ser anterior a la fecha de emisión.");
    }
  }

  // Moneda.
  if (invoice.currency === "USD") {
    if (!(Number(invoice.exchange_rate) > 0)) problems.push("En dólares hace falta la cotización.");
    if (invoice.same_currency_payment === null || invoice.same_currency_payment === undefined) {
      problems.push("En dólares indicá si se cobra en la misma moneda.");
    }
  } else if (invoice.currency !== "ARS") {
    problems.push("La moneda de la factura no es válida.");
  }

  // Importes.
  if (!(Number(invoice.total_amount) > 0) || !(Number(invoice.net_amount) > 0)) problems.push("La factura tiene que tener un importe mayor a cero.");
  if (IVA_ID[Number(invoice.iva_rate)] === undefined) problems.push(`ARCA no tiene la alícuota de IVA ${Number(invoice.iva_rate)}%.`);
  if (!invoice.lines || invoice.lines.length === 0) problems.push("La factura no tiene líneas.");

  return problems;
}

/**
 * Pedido a FECAESolicitar (un solo comprobante). Las claves van en el ORDEN del WSDL de ARCA (ASMX es sensible al orden):
 * ... MonId, MonCotiz, CanMisMonExt, CondicionIVAReceptorId, CbtesAsoc, Tributos, Iva, Opcionales ...
 * Los importes van en la moneda de la factura. B11: ARCA exige que el total sea neto + IVA y que el IVA de cada alícuota
 * coincida con su base: se calcula por alícuota sobre la base total (como `computeInvoiceTotals`), nunca por línea.
 */
function buildCaeRequest({ invoice, number, pointOfSale }) {
  const concept = Number(invoice.arca_concept);
  const withService = concept !== CONCEPTO.PRODUCTOS;
  const isUsd = invoice.currency === "USD";
  const net = round2(invoice.net_amount);
  const iva = round2(invoice.iva_amount);

  const detail = {
    Concepto: concept,
    DocTipo: DOC_TIPO.CUIT,
    DocNro: Number(normalizeCuit(invoice.recipient_doc_number)),
    CbteDesde: number,
    CbteHasta: number,
    CbteFch: toArcaDate(invoice.issue_date),
    ImpTotal: round2(net + iva),
    ImpTotConc: 0,
    ImpNeto: net,
    ImpOpEx: 0,
    ImpTrib: 0,
    ImpIVA: iva,
  };
  if (withService) {
    detail.FchServDesde = toArcaDate(invoice.service_from);
    detail.FchServHasta = toArcaDate(invoice.service_to);
    detail.FchVtoPago = toArcaDate(invoice.due_date);
  }
  detail.MonId = isUsd ? "DOL" : "PES";
  detail.MonCotiz = isUsd ? Number(Number(invoice.exchange_rate).toFixed(6)) : 1;
  if (isUsd) detail.CanMisMonExt = invoice.same_currency_payment ? "S" : "N";
  detail.CondicionIVAReceptorId = Number(invoice.recipient_vat_condition_id);
  detail.Iva = { AlicIva: [{ Id: IVA_ID[Number(invoice.iva_rate)], BaseImp: net, Importe: iva }] };

  return {
    FeCAEReq: {
      FeCabReq: { CantReg: 1, PtoVta: Number(pointOfSale.number), CbteTipo: Number(invoice.cbte_tipo) },
      FeDetReq: { FECAEDetRequest: [detail] },
    },
  };
}

const asArray = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

/** Lee la respuesta de FECAESolicitar. `approved` solo con Resultado "A" y CAE presente. */
function parseCaeResponse(result) {
  const header = (result && result.FeCabResp) || {};
  const det = asArray(result && result.FeDetResp && result.FeDetResp.FECAEDetResponse)[0] || {};
  const resultado = det.Resultado || header.Resultado || null;
  const observations = asArray(det.Observaciones && det.Observaciones.Obs).map((o) => ({ code: Number(o.Code), msg: String(o.Msg) }));
  const events = asArray(result && result.Events && result.Events.Evt).map((e) => ({ code: Number(e.Code), msg: String(e.Msg) }));
  const cae = det.CAE ? String(det.CAE).trim() : null;
  return {
    approved: resultado === "A" && !!cae,
    resultado,
    cae,
    cae_expiration: fromArcaDate(det.CAEFchVto),
    number: det.CbteDesde ? Number(det.CbteDesde) : null,
    process_date: header.FchProceso ? String(header.FchProceso) : null,
    observations,
    events,
  };
}

/** Texto legible de lo que ARCA observó o rechazó. */
function describeRejection(parsed) {
  const items = [...parsed.observations, ...parsed.events.filter(() => parsed.observations.length === 0)];
  return items.length ? items.map((o) => `(${o.code}) ${o.msg}`).join(" · ") : "ARCA no devolvió el motivo.";
}

/** Emisor congelado al autorizar (S9): el PDF se arma solo desde acá. */
function buildIssuerSnapshot(company, pointOfSale) {
  return {
    legal_name: company.legal_name,
    display_name: company.display_name || company.legal_name,
    cuit: normalizeCuit(company.cuit),
    vat_condition: company.vat_condition,
    iibb_number: company.iibb_number || null,
    activity_start_date: company.activity_start_date || null,
    address: {
      street: company.address_street, number: company.address_number || null,
      locality: company.address_locality, province: company.address_province,
    },
    pos_address: pointOfSale.address || null,
    email: company.email || null,
    phone: company.phone || null,
    point_of_sale: { number: pointOfSale.number, usage_description: pointOfSale.usage_description || null },
  };
}

/** Receptor congelado al autorizar (S9). */
function buildRecipientSnapshot(client, invoice) {
  return {
    legal_name: client.razonSocial,
    cuit: normalizeCuit(invoice.recipient_doc_number || client.cuit),
    doc_type: invoice.recipient_doc_type || DOC_TIPO.CUIT,
    vat_condition_id: invoice.recipient_vat_condition_id,
    vat_condition: RECEIVER_VAT_CONDITIONS_CLASS_A[Number(invoice.recipient_vat_condition_id)] || null,
    address: { street: client.fiscal_street || null, locality: client.fiscal_locality || null, province: client.fiscal_province || null },
  };
}

module.exports = {
  toArcaDate, fromArcaDate, daysBetween, voucherLabel, checkIssueDate, validateEmission, buildCaeRequest,
  parseCaeResponse, describeRejection, buildIssuerSnapshot, buildRecipientSnapshot, round2,
};
