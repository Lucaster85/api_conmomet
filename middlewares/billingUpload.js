"use strict";
const multer = require("multer");

/**
 * Upload de los archivos del módulo de Facturación (OC del cliente, pólizas de caución, documentos extra del presupuesto) — PLAN_ARCA.md §8, S7.
 *
 * A diferencia del `upload` sin límites de routes/index.js, acá hay límite de tamaño y de cantidad y se filtra por tipo, y los errores de multer se
 * traducen a un 400 legible. Patrón de middlewares/candidateUpload.js. Se exige que coincidan el tipo declarado Y la extensión (el navegador manda el
 * tipo y es trivial de falsear): no es una defensa contra un archivo malicioso (el bucket es privado y nada se ejecuta), solo evita errores y basura.
 */
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 10;

const ALLOWED = {
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
};

const FORMAT_ERROR = "Formato no permitido. Solo se aceptan archivos PDF, Word, Excel, JPG o PNG.";

function fileFilter(req, file, cb) {
  const extensions = ALLOWED[file.mimetype];
  const name = String(file.originalname || "").toLowerCase();
  const ok = extensions && extensions.some((ext) => name.endsWith(ext));
  cb(ok ? null : new multer.MulterError("INVALID_FORMAT"), ok);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
  fileFilter,
}).array("files", MAX_FILES);

const MESSAGES = {
  LIMIT_FILE_SIZE: "Cada archivo puede pesar hasta 20 MB.",
  LIMIT_FILE_COUNT: `Podés adjuntar hasta ${MAX_FILES} archivos.`,
  LIMIT_UNEXPECTED_FILE: `Podés adjuntar hasta ${MAX_FILES} archivos.`,
  INVALID_FORMAT: FORMAT_ERROR,
};

function billingFilesUpload(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: MESSAGES[err.code] || "No se pudo procesar el archivo adjunto." });
    }
    return res.status(400).json({ error: err.message || "No se pudo procesar el archivo adjunto." });
  });
}

module.exports = { billingFilesUpload, MAX_FILE_BYTES, MAX_FILES, ALLOWED };
