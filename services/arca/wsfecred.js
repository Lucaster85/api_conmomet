// wsfecred: Registro de Facturas de Crédito Electrónica MiPyMEs (seguimiento de FCE, FLOWS.md §77). Con rol "Emisor" devuelve las FCE que emitimos (y sus ND/NC) con el
// estado que les dio el comprador, y las cuentas corrientes con su saldo. Solo lectura: aceptar o rechazar lo hace el comprador, no nosotros.
//
// Los nombres de los elementos salen del WSDL público (V 2.0.3 del manual, verificado el 20/11/2026). NO se pudo ver el ciclo completo contra ARCA (homologación solo
// muestra PendienteRecepcion/Recepcionado porque el comprador de prueba no es nuestro): por eso el mapeo es defensivo, un campo que falta queda en null y nunca se inventa
// un dato, y de cada comprobante se guarda un resumen saneado para diagnosticar en producción sin volver a llamar a ARCA.
const { ENVS, SERVICE_WSFECRED, FCE_CMP_STATES, FCE_ACCOUNT_STATES, FCE_ACCEPTANCE_TYPES } = require("./codes");
const { getArcaConfig } = require("./credentials");
const { getAuth } = require("./wsaa");
const { getSoapClient, toArcaError } = require("./soapClient");
const { soapRequestOptions } = require("./http");
const { ArcaError } = require("./errors");
const { stripArcaSecrets } = require("./sanitize");

// El servicio pagina de forma dinámica: tope para no quedar en un bucle si algo anda mal. Si se alcanza, se informa en el resultado.
const MAX_PAGES = 50;

const AUTHORIZE_HINT =
  'Autorizá el servicio "Registro de Facturas de Crédito Electrónica MiPyMEs" (wsfecred) para el certificado: en homologación, WSASS → "Crear autorización a servicio"; ' +
  "en producción, Administrador de Relaciones, asociado al computador fiscal (el certificado), no a la persona.";

const asArray = (value) => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]);
const text = (value, max) => {
  if (value === undefined || value === null) return null;
  const clean = String(value).replace(/\s+/g, " ").trim();
  return clean === "" ? null : clean.slice(0, max);
};
const intOrNull = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const moneyOrNull = (value) => {
  const n = intOrNull(value);
  return n === null ? null : Math.round(n * 100) / 100;
};
// xsd:date llega como texto "2026-11-20" (a veces con zona) o, según la versión de `soap`, como Date: en los dos casos se queda con AAAA-MM-DD.
function dateOnly(value) {
  if (value === undefined || value === null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value));
  return match ? match[1] : null;
}
function dateTime(value) {
  if (value === undefined || value === null || value === "") return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}
const oneOf = (value, allowed) => {
  const clean = text(value, 40);
  return clean && Object.prototype.hasOwnProperty.call(Array.isArray(allowed) ? Object.fromEntries(allowed.map((k) => [k, 1])) : allowed, clean) ? clean : null;
};

// Resumen del comprobante para guardar (D7): sin los renglones ni los textos largos, y con el CBU enmascarado (solo los últimos 4 dígitos).
const SNAPSHOT_DROP = new Set(["arrayitems", "datosgenerales", "datoscomerciales", "arraysubtotalesiva", "arrayotrostributos"]);
function maskCbu(value) {
  const digits = String(value).replace(/\D/g, "");
  return digits.length > 4 ? `${"*".repeat(digits.length - 4)}${digits.slice(-4)}` : "****";
}
function sanitizeSnapshot(value) {
  if (Array.isArray(value)) return value.map(sanitizeSnapshot);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (SNAPSHOT_DROP.has(key.toLowerCase())) continue;
      out[key] = /cbu/i.test(key) && (typeof val === "string" || typeof val === "number") ? maskCbu(val) : sanitizeSnapshot(val);
    }
    return out;
  }
  return value;
}

/**
 * Convierte un `ComprobanteType` de ARCA en lo que guardamos de una factura. Pura: se testea sin ARCA.
 * `cmp_state`/`account_code`/`acceptance_type` quedan en null si ARCA no los informó o trae un valor que no conocemos.
 */
function mapComprobante(raw) {
  const c = raw || {};
  const stateNode = c.estado && typeof c.estado === "object" ? c.estado : { estado: c.estado };
  const associated = c.idComprobanteAsociado;
  return {
    cbte_tipo: intOrNull(c.codTipoCmp),
    pos_number: intOrNull(c.ptovta !== undefined ? c.ptovta : c.ptoVta),
    number: intOrNull(c.nroCmp),
    recipient_cuit: text(c.cuitReceptor, 11),
    cmp_state: oneOf(stateNode.estado, FCE_CMP_STATES),
    cmp_state_at: dateTime(stateNode.fechaHoraEstado),
    account_code: intOrNull(c.codCtaCte),
    acceptance_type: oneOf(c.tipoAcep, FCE_ACCEPTANCE_TYPES),
    accepted_at: dateTime(c.fechaHoraAcep),
    available_at: dateOnly(c.fechaPuestaDispo),
    acceptance_due: dateOnly(c.fechaVenAcep),
    payment_due: dateOnly(c.fechaVenPago),
    rejection_reasons: asArray(c.arrayMotivosRechazo && c.arrayMotivosRechazo.motivoRechazo).map((m) => ({
      code: intOrNull(m && m.codMotivo),
      description: text(m && m.descMotivo, 250),
      justification: text(m && m.justificacion, 250),
    })),
    transfer_option: ["SCA", "ADC"].includes(text(c.opcionTransferencia, 3)) ? text(c.opcionTransferencia, 3) : null,
    is_annulment: c.esAnulacion === undefined || c.esAnulacion === null ? null : String(c.esAnulacion).toUpperCase() === "S",
    associated: associated ? { cbte_tipo: intOrNull(associated.codTipoCmp), pos_number: intOrNull(associated.ptoVta), number: intOrNull(associated.nroCmp) } : null,
    total: moneyOrNull(c.importeTotal),
    currency: text(c.codMoneda, 3),
    snapshot: sanitizeSnapshot(stripArcaSecrets(c)),
  };
}

/** Convierte un `InfoCtaCteType` (de `consultarCtasCtes`) en lo que guardamos de la cuenta corriente de una factura. Pura. */
function mapCtaCte(raw) {
  const a = raw || {};
  const stateNode = a.estadoCtaCte && typeof a.estadoCtaCte === "object" ? a.estadoCtaCte : { estado: a.estadoCtaCte };
  const invoice = a.idFacturaCredito || {};
  return {
    account_code: intOrNull(a.codCtaCte),
    account_state: oneOf(stateNode.estado, FCE_ACCOUNT_STATES),
    account_state_at: dateTime(stateNode.fechaHoraEstado),
    cbte_tipo: intOrNull(invoice.codTipoCmp),
    pos_number: intOrNull(invoice.ptoVta),
    number: intOrNull(invoice.nroCmp),
    total: moneyOrNull(a.importeTotalFC),
    balance: moneyOrNull(a.saldo),
    accepted_balance: moneyOrNull(a.saldoAceptado),
    currency: text(a.codMoneda, 3),
    transfer_option: ["SCA", "ADC"].includes(text(a.opcionTransferencia, 3)) ? text(a.opcionTransferencia, 3) : null,
  };
}

/** Historial de estados (comprobante o cuenta corriente) → [{ state, at }] en el orden en que lo da ARCA. */
function mapHistory(ret) {
  return asArray(ret && ret.arrayHistorialEstados && ret.arrayHistorialEstados.estadoHistorico).map((e) => ({
    state: text(e && e.estado, 40),
    at: dateTime(e && e.fechaHoraEstado),
  }));
}

// Errores de formato y de negocio vienen dentro de la respuesta. La observación 32767 ("sin resultados") no es un error: queda una lista vacía.
function throwIfErrors(ret, context) {
  const format = asArray(ret && ret.arrayErroresFormato && ret.arrayErroresFormato.codigoDescripcionString);
  const business = asArray(ret && ret.arrayErrores && ret.arrayErrores.codigoDescripcion);
  const all = [...format, ...business];
  if (all.length > 0) {
    throw new ArcaError("afip", `${context}: ${all.map((e) => `(${e.codigo}) ${e.descripcion}`).join(" · ")}`, { details: { codes: all.map((e) => String(e.codigo)) } });
  }
}

async function getWsfecredClient() {
  const config = getArcaConfig();
  if (!config.enabled) throw new ArcaError(config.error ? "config" : "disabled", config.error || "La integración con ARCA está apagada (ARCA_ENV sin definir).");
  const urls = ENVS[config.env];
  return getSoapClient(urls.wsfecredWsdl, urls.wsfecredEndpoint);
}

/** Login (WSAA) para wsfecred. Si el certificado no tiene el servicio autorizado, el mensaje dice exactamente qué autorizar. */
async function getFecredAuth() {
  try {
    return await getAuth(SERVICE_WSFECRED);
  } catch (error) {
    if (error instanceof ArcaError && error.code === "afip") throw new ArcaError("afip", `${error.message} ${AUTHORIZE_HINT}`, { details: error.details });
    throw error;
  }
}

/** Llama a un método autenticado y devuelve su `<…>Return`. `returnKey` es el nombre del elemento de respuesta (cambia de método en método). */
async function call(method, returnKey, params, context) {
  const auth = await getFecredAuth();
  const client = await getWsfecredClient();
  try {
    const [response] = await client[`${method}Async`]({ authRequest: { token: auth.token, sign: auth.sign, cuitRepresentada: auth.cuit }, ...params }, soapRequestOptions());
    const ret = (response && response[returnKey]) || {};
    throwIfErrors(ret, context);
    return ret;
  } catch (error) {
    throw toArcaError(error, context);
  }
}

/** Estado de los servidores de wsfecred. No requiere autenticación. */
async function dummy() {
  const client = await getWsfecredClient();
  try {
    const [response] = await client.dummyAsync({}, soapRequestOptions());
    const r = (response && response.dummyReturn) || {};
    return { app_server: r.appserver, db_server: r.dbserver, auth_server: r.authserver };
  } catch (error) {
    throw toArcaError(error, "No se pudo consultar el estado del servicio de seguimiento de FCE de ARCA");
  }
}

const dateFilter = (fecha) => (fecha ? { fecha: { tipo: fecha.tipo || "Emision", desde: fecha.desde, hasta: fecha.hasta } } : {});

/** Recorre todas las páginas de una consulta. Devuelve `{ items, truncated }`: si se alcanza el tope de páginas lo informa en vez de cortar callado. */
async function paginate(fetchPage) {
  const items = [];
  let truncated = false;
  for (let page = 1; ; page += 1) {
    const { rows, hasMore } = await fetchPage(page);
    items.push(...rows);
    if (!hasMore) break;
    if (page >= MAX_PAGES) {
      truncated = true;
      break;
    }
  }
  return { items, truncated };
}

/**
 * `consultarComprobantes` con rol Emisor: las FCE (y ND/NC) que emitimos. Filtros opcionales: `codTipoCmp`, `estadoCmp`, `codCtaCte`, `cuitContraparte`, `fecha: { tipo, desde, hasta }`.
 * @returns {Promise<{ items: object[], truncated: boolean }>} comprobantes ya mapeados con `mapComprobante`
 */
async function consultarComprobantes({ codTipoCmp, estadoCmp, codCtaCte, cuitContraparte, fecha } = {}) {
  return paginate(async (page) => {
    const ret = await call(
      "consultarComprobantes",
      "consultarCmpReturn",
      {
        rolCUITRepresentada: "Emisor",
        ...(cuitContraparte ? { CUITContraparte: cuitContraparte } : {}),
        ...(codTipoCmp ? { codTipoCmp } : {}),
        ...(estadoCmp ? { estadoCmp } : {}),
        ...dateFilter(fecha),
        ...(codCtaCte ? { codCtaCte } : {}),
        nroPagina: page,
      },
      "No se pudieron consultar las FCE en ARCA"
    );
    return { rows: asArray(ret.arrayComprobantes && ret.arrayComprobantes.comprobante).map(mapComprobante), hasMore: String(ret.hayMas || "N").toUpperCase() === "S" };
  });
}

/** `consultarCtasCtes` con rol Emisor: cuentas corrientes de las FCE con su estado y saldo. @returns {Promise<{ items: object[], truncated: boolean }>} */
async function consultarCtasCtes({ fecha, estadoCtaCte } = {}) {
  return paginate(async (page) => {
    const ret = await call(
      "consultarCtasCtes",
      "consultarCtasCtesReturn",
      { rolCUITRepresentada: "Emisor", ...dateFilter(fecha), ...(estadoCtaCte ? { estadoCtaCte } : {}), nroPagina: page },
      "No se pudieron consultar las cuentas corrientes de las FCE en ARCA"
    );
    return { rows: asArray(ret.arrayInfosCtaCte && ret.arrayInfosCtaCte.infoCtaCte).map(mapCtaCte), hasMore: String(ret.hayMas || "N").toUpperCase() === "S" };
  });
}

/** Historial de estados de un comprobante. `id`: { cuitEmisor, cbteTipo, posNumber, number }. */
async function consultarHistorialEstadosComprobante({ cuitEmisor, cbteTipo, posNumber, number }) {
  const ret = await call(
    "consultarHistorialEstadosComprobante",
    "consultarHistorialEstadosComprobanteReturn",
    { idComprobante: { CUITEmisor: cuitEmisor, codTipoCmp: Number(cbteTipo), ptoVta: Number(posNumber), nroCmp: Number(number) } },
    "No se pudo consultar el historial del comprobante en ARCA"
  );
  return mapHistory(ret);
}

/** Historial de estados de la cuenta corriente de una factura (por su `codCtaCte`). */
async function consultarHistorialEstadosCtaCte(codCtaCte) {
  const ret = await call(
    "consultarHistorialEstadosCtaCte",
    "consultarHistorialEstadosCtaCteReturn",
    { idCtaCte: { codCtaCte: Number(codCtaCte) } },
    "No se pudo consultar el historial de la cuenta corriente en ARCA"
  );
  return mapHistory(ret);
}

module.exports = {
  dummy, getFecredAuth, consultarComprobantes, consultarCtasCtes, consultarHistorialEstadosComprobante, consultarHistorialEstadosCtaCte,
  mapComprobante, mapCtaCte, mapHistory, throwIfErrors, sanitizeSnapshot, dateOnly, MAX_PAGES, AUTHORIZE_HINT,
};
