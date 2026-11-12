const path = require("path");
const { getFromR2 } = require("../helpers");

// Nombre seguro para el header: sin separadores de ruta ni caracteres de control/comillas.
const sanitizeFileName = (raw, fallback) => {
  const clean = String(raw || "")
    .replace(/[\\/\r\n"]/g, "_")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 200);
  return clean || fallback;
};

module.exports = {
  // GET /files/download?url=<URL pública del bucket>&name=<nombre sugerido>
  // Entrega el archivo con descarga forzada. El frontend lo pide con fetch + token y arma el blob,
  // así no depende de CORS del bucket ni de que el navegador "quiera" abrir el tipo de archivo.
  download: async (req, res) => {
    try {
      const { url, name } = req.query;
      if (!url || typeof url !== "string") {
        return res.status(400).json({ error: "Falta la URL del archivo" });
      }

      let file;
      try {
        file = await getFromR2(url);
      } catch (err) {
        if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
          return res.status(404).json({ error: "El archivo no existe" });
        }
        throw err;
      }
      if (!file) {
        return res.status(400).json({ error: "La URL no pertenece a los archivos de la aplicación" });
      }

      const fileName = sanitizeFileName(name, path.basename(file.key));
      // res.attachment arma Content-Disposition con filename ASCII + filename* (UTF-8) y pisa el
      // Content-Type según la extensión: por eso el tipo guardado en el bucket se setea después.
      res.attachment(fileName);
      res.setHeader("Content-Type", file.contentType || "application/octet-stream");
      if (file.contentLength) res.setHeader("Content-Length", file.contentLength);
      file.body.on("error", () => res.destroy());
      return file.body.pipe(res);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
