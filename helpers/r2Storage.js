const { S3Client, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const path = require("path");

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
  const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
  const ext = path.extname(file.originalname).toLowerCase();
  const key = `${folder}/${uniqueSuffix}${ext}`;

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

module.exports = { uploadToR2, deleteFromR2 };
