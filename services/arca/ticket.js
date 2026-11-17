// Parte pura de WSAA (sin base de datos ni red): armado y firma del ticket de login, lectura de la respuesta y
// validez del ticket guardado. Vive aparte de wsaa.js para poder testearse sin DB.
const forge = require("node-forge");
const { decryptSecret } = require("./tokenCrypto");
const { ArcaError } = require("./errors");

// B7: el ticket se renueva 10 minutos antes de vencer, y se genera con inicio "ahora − 10 min" para tolerar
// diferencias de reloj entre este server y ARCA.
const RENEW_MARGIN_MS = 10 * 60 * 1000;
const CLOCK_SKEW_MS = 10 * 60 * 1000;

const ARGENTINA_OFFSET_MS = 3 * 60 * 60 * 1000;

// Argentina no tiene horario de verano: UTC-3 fijo. Formato que acepta WSAA: 2026-11-16T10:00:00-03:00.
function toArgentinaIso(date) {
  return new Date(date.getTime() - ARGENTINA_OFFSET_MS).toISOString().replace(/\.\d{3}Z$/, "-03:00");
}

/** TRA (loginTicketRequest) sin firmar. Pura: recibe la hora, así se testea sin reloj. */
function buildLoginTicketRequest(service, now = new Date()) {
  const generation = new Date(now.getTime() - CLOCK_SKEW_MS);
  const expiration = new Date(now.getTime() + CLOCK_SKEW_MS);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<loginTicketRequest version="1.0"><header>` +
    `<uniqueId>${Math.floor(now.getTime() / 1000)}</uniqueId>` +
    `<generationTime>${toArgentinaIso(generation)}</generationTime>` +
    `<expirationTime>${toArgentinaIso(expiration)}</expirationTime>` +
    `</header><service>${service}</service></loginTicketRequest>`
  );
}

/** Firma el TRA en CMS (PKCS#7, contenido incluido) y lo devuelve en base64 DER, como espera `loginCms`. */
function signLoginTicket(traXml, cert, privateKey) {
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(traXml, "utf8");
  p7.addCertificate(cert);
  p7.addSigner({
    key: privateKey,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  });
  p7.sign();
  return forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());
}

function tagValue(xml, tag) {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  return match ? match[1].trim() : null;
}

/** Extrae token, sign y vencimiento de la respuesta de WSAA. Tira si falta algo. */
function parseLoginResponse(xml) {
  const token = tagValue(xml, "token");
  const sign = tagValue(xml, "sign");
  const expiration = tagValue(xml, "expirationTime");
  if (!token || !sign || !expiration) {
    throw new ArcaError("wsaa", "WSAA devolvió una respuesta sin credenciales.");
  }
  const expiresAt = new Date(expiration);
  if (Number.isNaN(expiresAt.getTime())) {
    throw new ArcaError("wsaa", "WSAA devolvió un vencimiento ilegible.");
  }
  return { token, sign, expiresAt };
}

function readCachedTicket(row, keyPem, now = Date.now()) {
  if (!row || !row.token_encrypted || !row.sign_encrypted || !row.expires_at) return null;
  if (new Date(row.expires_at).getTime() - now <= RENEW_MARGIN_MS) return null;
  const token = decryptSecret(row.token_encrypted, keyPem);
  const sign = decryptSecret(row.sign_encrypted, keyPem);
  if (!token || !sign) return null;
  return { token, sign, expiresAt: new Date(row.expires_at) };
}

module.exports = {
  buildLoginTicketRequest,
  signLoginTicket,
  parseLoginResponse,
  readCachedTicket,
  toArgentinaIso,
  RENEW_MARGIN_MS,
  CLOCK_SKEW_MS,
};
