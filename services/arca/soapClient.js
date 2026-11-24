// Clientes SOAP de ARCA (paquete `soap`). El WSDL se lee de ARCA al primer uso y el cliente queda en memoria; si la
// lectura falla no se cachea el error, así el próximo intento vuelve a probar. El endpoint se fija explícitamente
// para que nunca dependa de lo que diga el WSDL (que puede apuntar al ambiente equivocado).
const soap = require("soap");
const { soapRequestOptions } = require("./http");
const { ArcaError } = require("./errors");

const clients = new Map();

function getSoapClient(wsdlUrl, endpoint) {
  const cacheKey = `${wsdlUrl}|${endpoint}`;
  if (!clients.has(cacheKey)) {
    const promise = soap
      .createClientAsync(wsdlUrl, { wsdl_options: soapRequestOptions(), endpoint })
      .catch((error) => {
        clients.delete(cacheKey);
        throw toArcaError(error, "No se pudo leer la descripción del servicio de ARCA");
      });
    clients.set(cacheKey, promise);
  }
  return clients.get(cacheKey);
}

// Convierte cualquier falla de red o SOAP en un ArcaError legible. Nunca copia el sobre SOAP, el pedido ni las
// credenciales al mensaje (S2): solo el texto del fault de ARCA, que es público, y el código de red.
function toArcaError(error, context) {
  if (error instanceof ArcaError) return error;
  const fault = error && error.root && error.root.Envelope && error.root.Envelope.Body && error.root.Envelope.Body.Fault;
  if (fault) {
    const text = String(fault.faultstring || fault.faultcode || "error desconocido");
    return new ArcaError("afip", `${context}: ${text}`, { details: { faultcode: fault.faultcode || null } });
  }
  const code = error && (error.code || (error.cause && error.cause.code));
  if (code === "ECONNABORTED" || code === "ETIMEDOUT") {
    return new ArcaError("network", `${context}: ARCA no respondió a tiempo (30 s).`, { details: { code } });
  }
  if (code && String(code).startsWith("ERR_SSL")) {
    return new ArcaError("network", `${context}: falló la conexión segura con ARCA (${code}).`, { details: { code } });
  }
  return new ArcaError("network", `${context}: no se pudo conectar con ARCA${code ? ` (${code})` : ""}.`, { details: { code: code || null } });
}

module.exports = { getSoapClient, toArcaError };
