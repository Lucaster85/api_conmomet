// Padrón A13 de ARCA (PLAN_ARCA.md etapa 10, FLOWS.md §73): datos públicos de un contribuyente a partir de su CUIT, para autocompletar un cliente (razón social y
// domicilio fiscal real). Servicio `ws_sr_padron_a13`: hay que autorizarlo en el certificado (WSASS) además de `wsfe`; el ticket de WSAA se guarda aparte, por servicio.
//
// NO se pudo verificar contra ARCA desde el desarrollo (necesita ese servicio autorizado): el mapeo se hizo con la descripción del servicio y es defensivo (cualquier
// campo que falte queda en null, y nunca se inventa un dato). Probarlo en homologación con un CUIT del padrón de pruebas. Ver FLOWS.md §73.
const { ENVS, SERVICE_PADRON_A13 } = require("./codes");
const { getArcaConfig } = require("./credentials");
const { getAuth } = require("./wsaa");
const { getSoapClient, toArcaError } = require("./soapClient");
const { soapRequestOptions } = require("./http");
const { ArcaError } = require("./errors");
const { isValidCuit, normalizeCuit } = require("../../helpers/cuit");

const asArray = (value) => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]);
const text = (value, max) => {
  if (value === undefined || value === null) return null;
  const clean = String(value).replace(/\s+/g, " ").trim();
  return clean === "" ? null : clean.slice(0, max);
};

// ARCA devuelve los nombres en mayúsculas ("CONMOMET S.A."): se dejan como vienen (son el nombre fiscal), salvo las personas físicas, que se muestran "Apellido Nombre".
const titleCase = (value) => value.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, sep, ch) => `${sep}${ch.toUpperCase()}`);

/**
 * Convierte la respuesta de `getPersona` (`personaReturn`) en los datos que usa un cliente. Pura: se testea sin ARCA.
 * @returns {{ cuit, legal_name, person_type, status, tax_condition, fiscal_street, fiscal_locality, fiscal_province, postal_code }}
 * @throws {ArcaError} si ARCA no encontró al contribuyente
 */
function mapPersona(personaReturn, requestedCuit) {
  const ret = personaReturn || {};
  const constanciaErrors = asArray(ret.errorConstancia && ret.errorConstancia.error).map((e) => text(e, 200)).filter(Boolean);
  const general = ret.datosGenerales || (ret.persona && ret.persona.datosGenerales) || null;
  if (!general) {
    throw new ArcaError("afip", constanciaErrors.length > 0 ? `El padrón de ARCA no encontró el CUIT: ${constanciaErrors.join(" · ")}` : "El padrón de ARCA no encontró el CUIT.");
  }

  const personType = text(general.tipoPersona, 20);
  const isCompany = personType === "JURIDICA";
  const company = text(general.razonSocial, 200);
  const person = [text(general.apellido, 100), text(general.nombre, 100)].filter(Boolean).join(" ");
  const legalName = isCompany ? company : (person ? titleCase(person) : company);

  const address = general.domicilioFiscal || {};
  // Condición frente al IVA: solo si el padrón la informa sin ambigüedad (monotributo, o IVA entre los impuestos activos). Si no, no se sugiere nada.
  const taxes = asArray(ret.datosRegimenGeneral && ret.datosRegimenGeneral.impuesto);
  const hasIva = taxes.some((t) => Number(t.idImpuesto) === 30 && String(t.estadoImpuesto || "AC").toUpperCase() === "AC");
  const taxCondition = ret.datosMonotributo ? "monotributo" : hasIva ? "responsable_inscripto" : null;

  return {
    cuit: normalizeCuit(general.idPersona) || normalizeCuit(requestedCuit),
    legal_name: legalName,
    person_type: personType,
    status: text(general.estadoClave, 20),
    tax_condition: taxCondition,
    fiscal_street: text(address.direccion, 150),
    fiscal_locality: text(address.localidad, 100),
    fiscal_province: text(address.descripcionProvincia, 100),
    postal_code: text(address.codPostal, 10),
  };
}

async function getPadronClient() {
  const config = getArcaConfig();
  if (!config.enabled) throw new ArcaError(config.error ? "config" : "disabled", config.error || "La integración con ARCA está apagada (ARCA_ENV sin definir).");
  const urls = ENVS[config.env];
  return getSoapClient(urls.padronWsdl, urls.padronEndpoint);
}

/** Consulta el padrón A13 por CUIT. Lanza ArcaError con un mensaje legible si el servicio no está autorizado, ARCA no responde o no hay datos. */
async function getPersona(cuit) {
  const normalized = normalizeCuit(cuit);
  if (!isValidCuit(normalized)) throw new ArcaError("input", "El CUIT no es válido.");
  let auth;
  try {
    auth = await getAuth(SERVICE_PADRON_A13);
  } catch (error) {
    // Lo más común: el certificado todavía no tiene autorizado el servicio ws_sr_padron_a13 en ARCA.
    if (error instanceof ArcaError && error.code === "afip") {
      throw new ArcaError("afip", `${error.message} Autorizá el servicio "ws_sr_padron_a13" para el certificado en ARCA (WSASS) para usar la consulta de CUIT.`);
    }
    throw error;
  }
  const client = await getPadronClient();
  try {
    const [response] = await client.getPersonaAsync({ token: auth.token, sign: auth.sign, cuitRepresentada: auth.cuit, idPersona: normalized }, soapRequestOptions());
    return mapPersona(response && response.personaReturn, normalized);
  } catch (error) {
    throw toArcaError(error, "No se pudo consultar el padrón de ARCA");
  }
}

module.exports = { getPersona, mapPersona };
