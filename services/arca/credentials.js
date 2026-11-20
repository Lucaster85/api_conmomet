// Configuración y credenciales de ARCA, todo desde variables de entorno (PLAN_ARCA.md §4b). El certificado y la clave
// NUNCA van en el repo ni en la imagen de Docker.
//
//   ARCA_ENV        homologacion | produccion. Sin valor = integración apagada.
//   ARCA_CUIT       CUIT emisor (el del Auth de cada pedido y el del QR). Coincide con el dueño del certificado,
//                   salvo con delegación, donde es el CUIT representado.
//   ARCA_CERT_B64 / ARCA_KEY_B64   contenido del .crt / .key en base64, en una línea (Railway, Docker).
//   ARCA_CERT_PATH / ARCA_KEY_PATH ruta a los archivos (local). Si existe *_B64, gana.
//
// Nada de acá tira al importarse: si falta algo, el error aparece recién en "Probar conexión" o al emitir, con un
// mensaje claro, sin tirar abajo el server (S5).
const fs = require("fs");
const forge = require("node-forge");
const { ArcaError } = require("./errors");
const { ENVS } = require("./codes");
const { isValidCuit, normalizeCuit } = require("../../helpers/cuit");

// Se loguea solo el titular y el vencimiento (S5), nunca el contenido del certificado ni de la clave.
const EXPIRY_WARNING_DAYS = 30;

/** Estado de la configuración, sin tocar archivos ni red. `error` explica por qué no se puede usar. */
function getArcaConfig(env = process.env) {
  const rawEnv = (env.ARCA_ENV || "").trim().toLowerCase();
  if (!rawEnv) return { enabled: false, env: null, cuit: null, error: null };

  if (!ENVS[rawEnv]) {
    return { enabled: false, env: null, cuit: null, error: `ARCA_ENV tiene un valor inválido ("${rawEnv}"). Usá "homologacion" o "produccion".` };
  }

  const cuit = normalizeCuit(env.ARCA_CUIT);
  if (!cuit || !isValidCuit(cuit)) {
    return { enabled: false, env: rawEnv, cuit: null, error: "ARCA_CUIT falta o no es un CUIT válido." };
  }

  return { enabled: true, env: rawEnv, cuit, error: null };
}

function readPem(b64Value, pathValue, label) {
  if (b64Value && b64Value.trim()) {
    const pem = Buffer.from(b64Value.trim(), "base64").toString("utf8");
    if (!pem.includes("-----BEGIN")) {
      throw new ArcaError("config", `${label}: el valor en base64 no es un PEM válido. Revisá que esté en una sola línea y completo.`);
    }
    return pem;
  }
  if (pathValue && pathValue.trim()) {
    try {
      return fs.readFileSync(pathValue.trim(), "utf8");
    } catch {
      // Sin la ruta en el mensaje: no hace falta exponer el filesystem del server.
      throw new ArcaError("config", `${label}: no se pudo leer el archivo configurado.`);
    }
  }
  return null;
}

let cache = { fingerprint: null, value: null };

/** Lee y valida el par certificado/clave. Tira ArcaError('config') con un mensaje claro si algo falla. */
function loadCredentials(env = process.env) {
  const config = getArcaConfig(env);
  if (config.error) throw new ArcaError("config", config.error);
  if (!config.enabled) throw new ArcaError("disabled", "La integración con ARCA está apagada (ARCA_ENV sin definir).");

  const certPem = readPem(env.ARCA_CERT_B64, env.ARCA_CERT_PATH, "Certificado de ARCA");
  const keyPem = readPem(env.ARCA_KEY_B64, env.ARCA_KEY_PATH, "Clave privada de ARCA");
  if (!certPem) throw new ArcaError("config", "Falta el certificado de ARCA (ARCA_CERT_B64 o ARCA_CERT_PATH).");
  if (!keyPem) throw new ArcaError("config", "Falta la clave privada de ARCA (ARCA_KEY_B64 o ARCA_KEY_PATH).");

  const fingerprint = `${certPem.length}:${keyPem.length}:${certPem.slice(-40)}:${keyPem.slice(-40)}`;
  if (cache.fingerprint === fingerprint) return cache.value;

  let cert;
  let privateKey;
  try {
    cert = forge.pki.certificateFromPem(certPem);
  } catch {
    throw new ArcaError("config", "El certificado de ARCA no se pudo leer: tiene que ser un .crt en formato PEM.");
  }
  try {
    privateKey = forge.pki.privateKeyFromPem(keyPem);
  } catch {
    throw new ArcaError("config", "La clave privada de ARCA no se pudo leer: tiene que ser un .key en formato PEM, sin contraseña.");
  }
  if (!cert.publicKey.n || cert.publicKey.n.compareTo(privateKey.n) !== 0 || cert.publicKey.e.compareTo(privateKey.e) !== 0) {
    throw new ArcaError("config", "La clave privada no corresponde al certificado de ARCA.");
  }

  const notAfter = cert.validity.notAfter;
  if (notAfter.getTime() < Date.now()) {
    throw new ArcaError("config", `El certificado de ARCA venció el ${notAfter.toISOString().slice(0, 10)}. Hay que renovarlo.`);
  }

  const value = { certPem, keyPem, cert, privateKey };
  cache = { fingerprint, value };
  return value;
}

/** Datos del certificado para mostrar (titular y vencimiento). Nunca devuelve clave ni PEM. */
function describeCertificate(env = process.env) {
  const config = getArcaConfig(env);
  if (!config.enabled) return null;
  try {
    const { cert } = loadCredentials(env);
    const subject = cert.subject.getField("CN");
    const notAfter = cert.validity.notAfter;
    const daysLeft = Math.floor((notAfter.getTime() - Date.now()) / 86400000);
    return {
      ok: true,
      subject: subject ? subject.value : null,
      expires_at: notAfter.toISOString(),
      days_left: daysLeft,
      expiring_soon: daysLeft <= EXPIRY_WARNING_DAYS,
    };
  } catch (error) {
    // Un certificado vencido también cae acá (loadCredentials lo rechaza), así que se avisa igual.
    return { ok: false, error: error instanceof ArcaError ? error.message : "No se pudo leer el certificado." };
  }
}

/** S5: al arrancar se valida el par certificado/clave y se loguea SOLO el titular y el vencimiento. Nunca tira. */
function logStartupStatus(env = process.env, log = console) {
  const config = getArcaConfig(env);
  if (config.error) return log.warn(`[arca] Configuración inválida: ${config.error}`);
  if (!config.enabled) return log.log("[arca] Integración apagada (ARCA_ENV sin definir).");

  const cert = describeCertificate(env);
  if (!cert || !cert.ok) return log.warn(`[arca] ${config.env}: ${cert ? cert.error : "no se pudo leer el certificado."}`);
  const warning = cert.expiring_soon ? ` — ATENCIÓN: vence en ${cert.days_left} días` : "";
  log.log(`[arca] ${config.env}: certificado de "${cert.subject}", vence el ${cert.expires_at.slice(0, 10)}${warning}`);
}

module.exports = { getArcaConfig, loadCredentials, describeCertificate, logStartupStatus, EXPIRY_WARNING_DAYS };
