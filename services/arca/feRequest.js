// Parte pura de la emisión (sin base de datos ni red): armado del pedido a FECAESolicitar, lectura de la respuesta y las
// validaciones que conviene hacer ANTES de llamar a ARCA (PLAN_ARCA.md §8, B3 y B11). Se testea sin SOAP.
const {
  CBTE_TIPO, CBTE_TIPO_LABELS, DOC_TIPO, CONCEPTO, IVA_ID, RECEIVER_VAT_CONDITIONS_CLASS_A, CLIENT_TAX_CONDITION_TO_ARCA,
  FCE_TIPOS, OPCIONAL, FCE_TRANSFER_OPTIONS, REFERENCIA_COMERCIAL_MAX, NOTE_CBTE, CREDIT_NOTE_TIPOS, DEBIT_NOTE_TIPOS,
} = require("./codes");
const { isValidCuit, normalizeCuit } = require("../../helpers/cuit");
const { isValidCbu, isValidCbuAlias } = require("../../helpers/cbu");

// ¿Es una Factura de Crédito Electrónica MiPyMEs (201/202/203)?
const isFce = (cbteTipo) => FCE_TIPOS.includes(Number(cbteTipo));
// La FCE propiamente dicha (201): lleva CBU, alias y transferencia. Sus notas (202 y 203) NO: ARCA las rechaza si los llevan (10172).
const isFceInvoice = (cbteTipo) => Number(cbteTipo) === CBTE_TIPO.FCE_A_FACTURA;
const isFceNote = (cbteTipo) => [CBTE_TIPO.FCE_A_NOTA_DEBITO, CBTE_TIPO.FCE_A_NOTA_CREDITO].includes(Number(cbteTipo));
const isCreditNote = (cbteTipo) => CREDIT_NOTE_TIPOS.includes(Number(cbteTipo));
const isDebitNote = (cbteTipo) => DEBIT_NOTE_TIPOS.includes(Number(cbteTipo));
const isNote = (cbteTipo) => isCreditNote(cbteTipo) || isDebitNote(cbteTipo);
// Tipo de la nota según la factura original ("credit_note" | "debit_note"). null si la original no admite notas desde la app.
const noteCbteFor = (originalCbteTipo, kind) => (NOTE_CBTE[Number(originalCbteTipo)] || {})[kind] || null;

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
 * @param {object|null} [p.bankAccount] cuenta del emisor { cbu, alias, is_active }: obligatoria en una FCE
 * @param {object|null} [p.associated] factura original de una nota (plana): { cbte_tipo, arca_status, status, kind, currency, issue_date, fce_acceptance }
 * @param {object|null} p.company perfil del emisor
 * @param {object} p.config getArcaConfig()
 * @param {string} p.today YYYY-MM-DD (Argentina)
 */
function validateEmission({ invoice, client, pointOfSale, bankAccount = null, associated = null, company, config, today }) {
  const problems = [];

  if (!config || !config.enabled) {
    problems.push(config && config.error ? config.error : "La integración con ARCA está apagada en este servidor.");
    return problems;
  }

  const fce = isFceInvoice(invoice.cbte_tipo);
  const note = isNote(invoice.cbte_tipo);
  const fceNote = isFceNote(invoice.cbte_tipo);
  if (![CBTE_TIPO.FACTURA_A, CBTE_TIPO.FCE_A_FACTURA].includes(Number(invoice.cbte_tipo)) && !note) {
    problems.push("Por ahora la app solo emite Factura A, Factura de Crédito Electrónica (FCE) A y sus notas de crédito y débito por ARCA.");
  }

  // Notas: ARCA exige el comprobante asociado (10197) y que sea una factura ya autorizada. La nota hereda cliente y moneda de la original.
  if (note) {
    if (!associated) problems.push("Una nota de crédito o de débito necesita la factura original asociada.");
    else {
      if (associated.kind && associated.kind !== "invoice") problems.push("La nota tiene que estar asociada a una factura, no a otra nota.");
      if (associated.arca_status !== "authorized") problems.push("La factura original todavía no fue emitida en ARCA.");
      if (associated.status === "cancelled") problems.push("La factura original está anulada.");
      if (noteCbteFor(associated.cbte_tipo, isCreditNote(invoice.cbte_tipo) ? "credit_note" : "debit_note") !== Number(invoice.cbte_tipo)) {
        problems.push("El tipo de la nota no corresponde al tipo de la factura original.");
      }
      if (invoice.exchange_difference) {
        // Diferencia de cambio: la nota va en pesos y la factura original en dólares.
        if (associated.currency !== "USD" || invoice.currency !== "ARS") problems.push("La nota por diferencia de cambio va en pesos y sobre una factura en dólares.");
      } else if (invoice.currency && associated.currency && invoice.currency !== associated.currency) {
        problems.push("La nota tiene que estar en la misma moneda que la factura original.");
      }
      if (invoice.issue_date && associated.issue_date && invoice.issue_date < associated.issue_date) {
        problems.push("La fecha de la nota no puede ser anterior a la de la factura original.");
      }
      // La marca de anulación de una FCE solo la admite ARCA si el comprador la rechazó (10154). Se verifica con lo registrado a mano.
      if (fceNote && invoice.fce_annulment && associated.fce_acceptance !== "rejected") {
        problems.push("La anulación de una FCE solo corresponde si el cliente la rechazó en ARCA: registralo en la aceptación de la factura o emití la nota sin marca de anulación.");
      }
    }
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
  else if (company && normalizeCuit(client.cuit) === normalizeCuit(company.cuit)) problems.push("El CUIT del cliente no puede ser el mismo que el de la empresa que factura.");
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

  // FCE: ARCA exige CBU, opción de transferencia y vencimiento de pago (aunque el concepto sea solo productos). Esto se verificó en
  // homologación: sin estos datos rechaza con 10168, 10216 y 10163. El CBU se valida acá porque homologación NO controla el dígito
  // verificador (aceptó un CBU inventado) y un CBU mal tipeado en una FCE es un cobro que no llega.
  if (fce) {
    if (!bankAccount) problems.push("La FCE necesita una cuenta bancaria del emisor (CBU): elegila en la factura o cargala en Datos de mi empresa.");
    else if (!bankAccount.is_active) problems.push("La cuenta bancaria elegida está inactiva.");
    else if (!isValidCbu(bankAccount.cbu)) problems.push("El CBU de la cuenta bancaria elegida no es válido: revisalo en Datos de mi empresa.");
    else if (bankAccount.alias && !isValidCbuAlias(bankAccount.alias)) problems.push("El alias de la cuenta bancaria elegida no es válido: revisalo en Datos de mi empresa.");
    if (!FCE_TRANSFER_OPTIONS.includes(invoice.fce_transfer_option)) problems.push("Elegí la opción de transferencia de la FCE (SCA o ADC).");
    if (Number(invoice.arca_concept) === CONCEPTO.PRODUCTOS) {
      if (!invoice.due_date) problems.push("La FCE necesita el vencimiento de pago.");
      else if (invoice.issue_date && invoice.due_date < invoice.issue_date) problems.push("El vencimiento de pago no puede ser anterior a la fecha de emisión.");
    }
    if (invoice.commercial_reference && String(invoice.commercial_reference).length > REFERENCIA_COMERCIAL_MAX) {
      problems.push(`La referencia comercial de una FCE admite hasta ${REFERENCIA_COMERCIAL_MAX} caracteres.`);
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
function buildCaeRequest({ invoice, number, pointOfSale, bankAccount = null, associated = null, issuerCuit = null }) {
  const concept = Number(invoice.arca_concept);
  const withService = concept !== CONCEPTO.PRODUCTOS;
  const fce = isFceInvoice(invoice.cbte_tipo);
  const fceNote = isFceNote(invoice.cbte_tipo);
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
  }
  // En una FCE el vencimiento de pago es obligatorio aunque el concepto sea solo productos (ARCA 10163). Las NOTAS de FCE, en cambio, no
  // lo llevan nunca (10175); las notas de Factura A con servicios sí, como la factura (10035).
  if ((withService && !fceNote) || fce) detail.FchVtoPago = toArcaDate(invoice.due_date);
  detail.MonId = isUsd ? "DOL" : "PES";
  detail.MonCotiz = isUsd ? Number(Number(invoice.exchange_rate).toFixed(6)) : 1;
  if (isUsd) detail.CanMisMonExt = invoice.same_currency_payment ? "S" : "N";
  detail.CondicionIVAReceptorId = Number(invoice.recipient_vat_condition_id);
  // Notas de crédito y de débito: la factura original (CbtesAsoc, va después de la condición de IVA del receptor y antes del IVA). Sin
  // este dato ARCA rechaza con 10197. `Cuit` es el del emisor (el de la autenticación).
  if (isNote(invoice.cbte_tipo)) {
    detail.CbtesAsoc = {
      CbteAsoc: [{
        Tipo: Number(associated.cbte_tipo), PtoVta: Number(associated.pos_number), Nro: Number(associated.number),
        Cuit: String(issuerCuit), CbteFch: toArcaDate(associated.issue_date),
      }],
    };
  }
  detail.Iva = { AlicIva: [{ Id: IVA_ID[Number(invoice.iva_rate)], BaseImp: net, Importe: iva }] };
  if (fceNote) {
    // Una nota de FCE exige el opcional 22 (anulación) y no admite CBU, alias ni transferencia. "N" = nota común; "S" = anulación, que
    // ARCA solo acepta si el comprador rechazó la FCE (10154). Verificado en homologación.
    detail.Opcionales = { Opcional: [{ Id: OPCIONAL.ANULACION, Valor: invoice.fce_annulment ? "S" : "N" }] };
  }
  if (fce) {
    // Opcionales de la FCE (S8: el texto libre lo serializa la librería SOAP, nunca se concatena XML): CBU y alias del emisor,
    // opción de transferencia y, si hay, la referencia comercial (el número de OC, que Bunge exige).
    const opcionales = [{ Id: OPCIONAL.CBU, Valor: normalizeCbuValue(bankAccount && bankAccount.cbu) }];
    if (bankAccount && bankAccount.alias) opcionales.push({ Id: OPCIONAL.ALIAS, Valor: String(bankAccount.alias) });
    opcionales.push({ Id: OPCIONAL.TRANSFERENCIA, Valor: String(invoice.fce_transfer_option) });
    if (invoice.commercial_reference) opcionales.push({ Id: OPCIONAL.REFERENCIA_COMERCIAL, Valor: String(invoice.commercial_reference).trim() });
    detail.Opcionales = { Opcional: opcionales };
  }

  return {
    FeCAEReq: {
      FeCabReq: { CantReg: 1, PtoVta: Number(pointOfSale.number), CbteTipo: Number(invoice.cbte_tipo) },
      FeDetReq: { FECAEDetRequest: [detail] },
    },
  };
}

const normalizeCbuValue = (cbu) => String(cbu || "").replace(/\D/g, "");

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

// Explicaciones en lenguaje claro de los rechazos más comunes, verificadas contra homologación (17/11/2026). ARCA ya devuelve un texto, pero
// no siempre dice qué hacer en esta app.
const REJECTION_HINTS = {
  10197: "Una nota de crédito o de débito necesita la factura original asociada.",
  10154: "ARCA solo permite anular una FCE (marca de anulación) si el cliente la rechazó. Si todavía no respondió, emití la nota sin marca de anulación.",
  10035: "Con servicios, ARCA exige el período facturado y el vencimiento de pago.",
  10184: "ARCA no deja que una nota de crédito de una FCE supere el saldo actual de su cuenta corriente (la factura, más las notas de débito, menos las de crédito ya emitidas). Revisá las notas anteriores de esa factura.",
  10176: "ARCA no encuentra a este cliente en su padrón o figura inactivo: revisá su CUIT en Clientes. Una FCE solo se puede emitir a un cliente registrado.",
  10069: "El CUIT del cliente no puede ser el mismo que el de la empresa que factura.",
  10162: "Una FCE necesita cuenta bancaria (CBU), opción de transferencia y vencimiento de pago.",
  10168: "Una FCE necesita el CBU de la cuenta del emisor: elegí una cuenta en la factura.",
  10216: "Elegí la opción de transferencia de la FCE (SCA o ADC).",
  10163: "Una FCE necesita el vencimiento de pago.",
  10189: `La referencia comercial de una FCE admite hasta ${REFERENCIA_COMERCIAL_MAX} caracteres.`,
};
const HOMOLOGACION_FCE_HINT = "En el ambiente de pruebas (homologación) ARCA solo reconoce algunos CUIT de prueba como clientes de una FCE (por ejemplo 33693450239).";

/**
 * Agrega al rechazo de ARCA qué hacer al respecto. `ctx`: { cbteTipo, env }.
 * - Códigos conocidos: la explicación de arriba.
 * - Una Factura A rechazada con un mensaje que habla de factura de crédito / MiPyMEs: es una HEURÍSTICA (ARCA exige FCE para ciertos
 *   clientes y rechaza la Factura A, pero el código exacto de ese rechazo no se pudo reproducir en homologación): sugiere emitir FCE.
 */
function explainRejection(text, codes = [], ctx = {}) {
  const hints = [];
  for (const code of codes) {
    const hint = REJECTION_HINTS[Number(code)];
    if (hint && !hints.includes(hint)) hints.push(hint);
  }
  if (codes.map(Number).includes(10176) && ctx.env === "homologacion") hints.push(HOMOLOGACION_FCE_HINT);
  if (Number(ctx.cbteTipo) === CBTE_TIPO.FACTURA_A && /cr[eé]dito|mipyme|\bFCE\b/i.test(text)) {
    hints.push("Es probable que este cliente deba recibir una Factura de Crédito Electrónica (FCE): probá emitiéndola con ese tipo.");
  }
  return hints.length ? `${text} — ${hints.join(" ")}` : text;
}

/** Texto legible de lo que ARCA observó o rechazó. */
function describeRejection(parsed) {
  const items = [...parsed.observations, ...parsed.events.filter(() => parsed.observations.length === 0)];
  return items.length ? items.map((o) => `(${o.code}) ${o.msg}`).join(" · ") : "ARCA no devolvió el motivo.";
}

/** Emisor congelado al autorizar (S9): el PDF se arma solo desde acá. */
function buildIssuerSnapshot(company, pointOfSale, bankAccount = null) {
  return {
    // Cuenta del emisor al emitir una FCE (CBU y alias congelados): sale en el PDF aunque después se edite la cuenta.
    ...(bankAccount ? { bank: { bank_name: bankAccount.bank_name, cbu: String(bankAccount.cbu), alias: bankAccount.alias || null } } : {}),
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
  parseCaeResponse, describeRejection, explainRejection, buildIssuerSnapshot, buildRecipientSnapshot, round2, isFce,
  isFceInvoice, isFceNote, isCreditNote, isDebitNote, isNote, noteCbteFor,
};
