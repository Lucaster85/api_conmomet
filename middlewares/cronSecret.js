"use strict";
const crypto = require("crypto");

// Protege los endpoints de cron (los llama un servicio externo, sin token de usuario).
// Si CRON_SECRET no está definida el endpoint queda CERRADO (503): antes, sin la variable, el
// header "Bearer undefined" pasaba. La comparación es de tiempo constante. FLOWS.md §75.2.
const verifyCronSecret = (req, res, next) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ error: "Cron deshabilitado." });

  const header = req.headers.authorization || "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(header);
  const ok = received.length === expected.length && crypto.timingSafeEqual(received, expected);
  if (!ok) return res.status(401).json({ error: "Unauthorized cron access." });
  next();
};

module.exports = { verifyCronSecret };
