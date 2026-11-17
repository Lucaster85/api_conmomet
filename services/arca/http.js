// B13: los servidores de ARCA usan parámetros de cifrado viejos y Node moderno falla con "dh key too small".
// Se baja el nivel de seguridad de OpenSSL SOLO para las llamadas a ARCA, con un agente propio. Nunca
// NODE_TLS_REJECT_UNAUTHORIZED=0: el certificado del servidor se sigue verificando.
// Si algún día hace falta, el otro ajuste habitual para servidores viejos es
// `secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT` (no se agrega hasta que haga falta).
const https = require("https");

const ARCA_CIPHERS = "DEFAULT@SECLEVEL=1";
const SOAP_TIMEOUT_MS = 30000;

let agent = null;
function getArcaHttpsAgent() {
  if (!agent) agent = new https.Agent({ ciphers: ARCA_CIPHERS, keepAlive: false });
  return agent;
}

// Opciones extra que `soap` pasa tal cual al request (axios): agente TLS + timeout de 30 s (B6).
function soapRequestOptions() {
  return { httpsAgent: getArcaHttpsAgent(), timeout: SOAP_TIMEOUT_MS };
}

module.exports = { getArcaHttpsAgent, soapRequestOptions, ARCA_CIPHERS, SOAP_TIMEOUT_MS };
