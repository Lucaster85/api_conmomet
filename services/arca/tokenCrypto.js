// S1: el token+sign de WSAA es una credencial (con eso y el CUIT se emite durante 12 h sin el certificado). En
// `arca_tokens` se guardan cifrados con AES-256-GCM. La clave se deriva de la clave privada del certificado: así no
// hace falta otra variable de entorno, y un backup de la base (que se sube a R2) no alcanza para usarlos.
// Si cambia la clave privada (certificado nuevo), los tokens viejos dejan de descifrar y se pide un login nuevo.
const crypto = require("crypto");

const VERSION = "v1";

function deriveKey(keyPem) {
  return crypto.createHash("sha256").update(`conmomet-arca-token-v1:${keyPem}`).digest();
}

function encryptSecret(plain, keyPem) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(keyPem), iv);
  const data = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), data.toString("base64")].join(":");
}

// Devuelve null (nunca tira) si el formato es inválido o la clave no corresponde: el que llama lo trata como
// "no hay token" y pide un login nuevo.
function decryptSecret(payload, keyPem) {
  try {
    const [version, iv, tag, data] = String(payload).split(":");
    if (version !== VERSION || !iv || !tag || !data) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(keyPem), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

module.exports = { encryptSecret, decryptSecret };
