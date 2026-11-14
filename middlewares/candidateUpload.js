"use strict";
const multer = require("multer");

/**
 * Upload de los papeles de un postulante (CV, carta, certificados). Se usa en la carga interna
 * (etapa 2) y en el formulario público "Trabajá con nosotros" (etapa 3) — ver FLOWS.md §59.
 *
 * A diferencia del resto de los multer de la app, acá se filtra por tipo y se traducen los errores
 * de multer a un 400 legible: el endpoint público lo usan personas sin usuario, que no tienen por
 * qué entender un "LIMIT_UNEXPECTED_FILE".
 */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 5;

const ALLOWED = {
  "application/pdf": [".pdf"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
};

const FORMAT_ERROR = "Formato no permitido. Solo se aceptan archivos PDF, Word (doc/docx), JPG o PNG.";

// Se exige que coincidan el tipo declarado Y la extensión: el tipo lo manda el navegador y es
// trivial de falsear, la extensión sola también. No es una defensa contra un archivo malicioso
// (los archivos se guardan en un bucket privado y nunca se ejecutan), solo evita errores y basura.
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
  LIMIT_FILE_SIZE: "Cada archivo puede pesar hasta 10 MB.",
  LIMIT_FILE_COUNT: `Podés adjuntar hasta ${MAX_FILES} archivos.`,
  LIMIT_UNEXPECTED_FILE: `Podés adjuntar hasta ${MAX_FILES} archivos.`,
  INVALID_FORMAT: FORMAT_ERROR,
};

function candidateFilesUpload(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: MESSAGES[err.code] || "No se pudo procesar el archivo adjunto." });
    }
    return res.status(400).json({ error: err.message || "No se pudo procesar el archivo adjunto." });
  });
}

module.exports = { candidateFilesUpload, MAX_FILE_BYTES, MAX_FILES, ALLOWED };
