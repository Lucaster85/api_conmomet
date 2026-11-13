const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const path = require("path");

const { randomUUID } = require("crypto");

const r2Client = new S3Client({
  region: "auto",
  endpoint: process.env.STORAGE_R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY,
  },
});

// Prefijos del bucket que NUNCA se exponen desde la app (ej. los dumps diarios de la base que sube
// el workflow daily-backup.yml). keyFromStoredUrl devuelve null para cualquier key que empiece así.
const BLOCKED_PREFIXES = ["backups/"];

/**
 * Convierte lo que hay guardado en la base (la "referencia canónica") en la key del bucket.
 * Es el único lugar que hace esta conversión: getFromR2, deleteFromR2 y getSignedFileUrl pasan por acá.
 *  - Saca el prefijo STORAGE_PUBLIC_URL; si no coincide, usa el pathname de la URL, así sigue
 *    andando si algún día cambia el dominio público (o si el bucket pasa a ser privado).
 *  - Quita query y hash, y decodifica.
 *  - Rechaza keys vacías, con "..", o que caigan en un prefijo bloqueado.
 * @param {string} value - URL/referencia guardada en la base
 * @returns {string|null} key válida, o null
 */
const keyFromStoredUrl = (value) => {
  if (!value || typeof value !== "string") return null;

  const publicUrl = process.env.STORAGE_PUBLIC_URL;
  let raw;
  if (publicUrl && value.startsWith(`${publicUrl}/`)) {
    raw = value.slice(publicUrl.length + 1);
  } else {
    try {
      raw = new URL(value).pathname;
    } catch {
      return null;
    }
  }

  let key;
  try {
    key = decodeURIComponent(raw.split(/[?#]/)[0]);
  } catch {
    return null;
  }
  key = key.replace(/^\/+/, "");

  // Las keys que genera uploadToR2 son "<carpeta>/<uuid>.<ext>"; nunca llevan "..".
  if (!key || key.split("/").includes("..")) return null;
  if (BLOCKED_PREFIXES.some((prefix) => key.startsWith(prefix))) return null;
  return key;
};

/**
 * Sube un archivo al bucket R2 y retorna su referencia canónica.
 * La referencia (`${STORAGE_PUBLIC_URL}/${key}`) es lo que se guarda en la base y funciona como
 * identificador: con el bucket privado NO se puede abrir directo, hay que pedir una URL firmada
 * (getSignedFileUrl / POST /files/signed-urls).
 * @param {Express.Multer.File} file - El archivo de multer (debe usar memoryStorage)
 * @param {string} folder - Carpeta destino dentro del bucket (ej: "sliders", "logos")
 * @returns {Promise<string>} Referencia canónica del archivo subido
 */
const uploadToR2 = async (file, folder = "general") => {
  // UUID garantiza unicidad incluso en uploads concurrentes desde móvil
  // donde el archivo siempre se llama "image.jpg"
  const uuid = randomUUID();
  const ext = path.extname(file.originalname).toLowerCase() || ".bin";
  const key = `${folder}/${uuid}${ext}`;

  await r2Client.send(
    new PutObjectCommand({
      Bucket: process.env.STORAGE_BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    })
  );

  return `${process.env.STORAGE_PUBLIC_URL}/${key}`;
};

/**
 * Elimina un archivo del bucket R2 dada su referencia canónica.
 * Si la referencia no es válida (o no es nuestra) no hace nada.
 * @param {string} url - Referencia canónica del archivo a eliminar
 */
const deleteFromR2 = async (url) => {
  const key = keyFromStoredUrl(url);
  if (!key) return;

  await r2Client.send(
    new DeleteObjectCommand({
      Bucket: process.env.STORAGE_BUCKET,
      Key: key,
    })
  );
};

/**
 * Lee un archivo del bucket R2 dada su referencia canónica (para entregarlo con descarga forzada,
 * ver fileController#download). Devuelve null si la referencia no es válida o está bloqueada.
 * @param {string} url - Referencia canónica del archivo
 * @returns {Promise<{ body: import("stream").Readable, contentType?: string, contentLength?: number, key: string } | null>}
 */
const getFromR2 = async (url) => {
  const key = keyFromStoredUrl(url);
  if (!key) return null;

  const result = await r2Client.send(
    new GetObjectCommand({ Bucket: process.env.STORAGE_BUCKET, Key: key })
  );
  return { body: result.Body, contentType: result.ContentType, contentLength: result.ContentLength, key };
};

/**
 * Genera una URL firmada (presigned GET) de corta vida para abrir un archivo del bucket privado.
 * La firma va dentro de la URL, así que sirve en <img>, <iframe> y en el visor de Office.
 * @param {string} storedUrl - Referencia canónica guardada en la base
 * @param {{ expiresIn?: number, downloadName?: string }} [opts] - expiresIn en segundos (default 600);
 *   downloadName fuerza "Content-Disposition: attachment" con ese nombre (opcional)
 * @returns {Promise<string|null>} URL firmada, o null si la referencia no es válida
 */
const getSignedFileUrl = async (storedUrl, { expiresIn = 600, downloadName } = {}) => {
  const key = keyFromStoredUrl(storedUrl);
  if (!key) return null;

  const params = { Bucket: process.env.STORAGE_BUCKET, Key: key };
  if (downloadName) {
    const safe = String(downloadName).replace(/[\\/\r\n"]/g, "_").slice(0, 200);
    params.ResponseContentDisposition = `attachment; filename*=UTF-8''${encodeURIComponent(safe)}`;
  }
  return getSignedUrl(r2Client, new GetObjectCommand(params), { expiresIn });
};

module.exports = {
  uploadToR2,
  deleteFromR2,
  getFromR2,
  getSignedFileUrl,
  keyFromStoredUrl,
  BLOCKED_PREFIXES,
};
