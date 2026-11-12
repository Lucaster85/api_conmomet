const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
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

/**
 * Sube un archivo al bucket R2 y retorna la URL pública.
 * @param {Express.Multer.File} file - El archivo de multer (debe usar memoryStorage)
 * @param {string} folder - Carpeta destino dentro del bucket (ej: "sliders", "logos")
 * @returns {Promise<string>} URL pública del archivo subido
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
 * Elimina un archivo del bucket R2 dado su URL pública.
 * @param {string} url - URL pública del archivo a eliminar
 */
const deleteFromR2 = async (url) => {
  if (!url) return;
  const publicUrl = process.env.STORAGE_PUBLIC_URL;
  if (!url.startsWith(publicUrl)) return;

  const key = url.replace(`${publicUrl}/`, "");

  await r2Client.send(
    new DeleteObjectCommand({
      Bucket: process.env.STORAGE_BUCKET,
      Key: key,
    })
  );
};

/**
 * Lee un archivo del bucket R2 dada su URL pública (para entregarlo con descarga forzada, ver
 * fileController#download). Devuelve null si la URL no pertenece a nuestro bucket.
 * @param {string} url - URL pública del archivo
 * @returns {Promise<{ body: import("stream").Readable, contentType?: string, contentLength?: number, key: string } | null>}
 */
const getFromR2 = async (url) => {
  const publicUrl = process.env.STORAGE_PUBLIC_URL;
  if (!url || !publicUrl || !url.startsWith(`${publicUrl}/`)) return null;

  const key = decodeURIComponent(url.slice(publicUrl.length + 1).split(/[?#]/)[0]);
  // Las keys que genera uploadToR2 son "<carpeta>/<uuid>.<ext>"; nunca llevan "..".
  if (!key || key.split("/").includes("..")) return null;

  const result = await r2Client.send(
    new GetObjectCommand({ Bucket: process.env.STORAGE_BUCKET, Key: key })
  );
  return { body: result.Body, contentType: result.ContentType, contentLength: result.ContentLength, key };
};

module.exports = { uploadToR2, deleteFromR2, getFromR2 };
