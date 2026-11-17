// WSFEv1: facturación electrónica. En la etapa 1 solo las consultas que necesita "Datos de mi empresa" y "Probar
// conexión"; la emisión (FECAESolicitar, FECompConsultar) entra en la etapa 2.
const { ENVS } = require("./codes");
const { getArcaConfig } = require("./credentials");
const { getAuth } = require("./wsaa");
const { getSoapClient, toArcaError } = require("./soapClient");
const { soapRequestOptions } = require("./http");
const { ArcaError } = require("./errors");

// FEParam* sin resultados responde con un error "Sin Resultados" (602) en vez de una lista vacía: no es una falla.
const NO_RESULTS_CODE = 602;

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

async function getWsfeClient() {
  const config = getArcaConfig();
  if (!config.enabled) throw new ArcaError(config.error ? "config" : "disabled", config.error || "La integración con ARCA está apagada (ARCA_ENV sin definir).");
  const urls = ENVS[config.env];
  return getSoapClient(urls.wsfeWsdl, urls.wsfeEndpoint);
}

// Errores de negocio de ARCA: vienen dentro de la respuesta (Errors.Err), no como fault SOAP.
function throwIfAfipErrors(result, context, allowedCodes = []) {
  const errors = asArray(result && result.Errors && result.Errors.Err);
  const blocking = errors.filter((e) => !allowedCodes.includes(Number(e.Code)));
  if (blocking.length > 0) {
    const text = blocking.map((e) => `(${e.Code}) ${e.Msg}`).join(" · ");
    throw new ArcaError("afip", `${context}: ${text}`, { details: { codes: blocking.map((e) => Number(e.Code)) } });
  }
  return errors;
}

/** Llama a un método autenticado de WSFEv1 y devuelve su `<Método>Result`. */
async function callWsfe(method, params, { context, allowedCodes } = {}) {
  const auth = await getAuth();
  const client = await getWsfeClient();
  try {
    const [response] = await client[`${method}Async`](
      { Auth: { Token: auth.token, Sign: auth.sign, Cuit: auth.cuit }, ...params },
      soapRequestOptions()
    );
    const result = response[`${method}Result`] || {};
    throwIfAfipErrors(result, context || method, allowedCodes);
    return result;
  } catch (error) {
    throw toArcaError(error, context || method);
  }
}

/** FEDummy: estado de los servidores de ARCA. No requiere autenticación. */
async function dummy() {
  const client = await getWsfeClient();
  try {
    const [response] = await client.FEDummyAsync({}, soapRequestOptions());
    const r = response.FEDummyResult || {};
    return { app_server: r.AppServer, db_server: r.DbServer, auth_server: r.AuthServer };
  } catch (error) {
    throw toArcaError(error, "No se pudo consultar el estado de ARCA");
  }
}

/** FEParamGetPtosVenta: puntos de venta habilitados para web services. En homologación suele volver vacío. */
async function getPointsOfSale() {
  const result = await callWsfe("FEParamGetPtosVenta", {}, { context: "No se pudieron consultar los puntos de venta", allowedCodes: [NO_RESULTS_CODE] });
  return asArray(result.ResultGet && result.ResultGet.PtoVenta).map((p) => ({
    number: Number(p.Nro),
    emission_type: p.EmisionTipo || null,
    blocked: String(p.Bloqueado).toUpperCase() === "S",
    deactivated_at: p.FchBaja && String(p.FchBaja).toUpperCase() !== "NULL" ? String(p.FchBaja) : null,
  }));
}

/** FECompUltimoAutorizado: último número autorizado de un punto de venta y tipo de comprobante (0 si no hay). */
async function getLastAuthorized(posNumber, cbteTipo) {
  const result = await callWsfe(
    "FECompUltimoAutorizado",
    { PtoVta: Number(posNumber), CbteTipo: Number(cbteTipo) },
    { context: `No se pudo consultar el último comprobante del punto de venta ${posNumber}` }
  );
  return Number(result.CbteNro) || 0;
}

/** FEParamGetCotizacion: cotización de una moneda (por ejemplo "DOL") según ARCA. */
async function getExchangeRate(monId = "DOL") {
  const result = await callWsfe("FEParamGetCotizacion", { MonId: monId }, { context: "No se pudo consultar la cotización" });
  const quote = result.ResultGet || {};
  return { currency: quote.MonId || monId, rate: Number(quote.MonCotiz), date: quote.FchCotiz ? String(quote.FchCotiz) : null };
}

module.exports = { dummy, getPointsOfSale, getLastAuthorized, getExchangeRate, callWsfe, asArray, throwIfAfipErrors };
