"use strict";
const rateLimit = require("express-rate-limit");

/**
 * Límite de intentos FALLIDOS de login (y de "cambiar mi contraseña", que verifica la actual y
 * serviría para adivinarla). FLOWS.md §75.2. Se cuentan solo las respuestas de error
 * (`skipSuccessfulRequests`): entrar bien no gasta intentos.
 *
 * Dos limitadores en cadena:
 *  - por IP + email: 5 fallidos cada 15 min (frena la fuerza bruta sobre una cuenta);
 *  - solo por IP: 30 fallidos cada 15 min (frena el barrido de muchos emails, sin bloquear a una
 *    oficina entera detrás de la misma IP por culpa de una sola persona).
 * Los máximos se leen en cada request (LOGIN_RATE_LIMIT_MAX / LOGIN_RATE_LIMIT_IP_MAX) para
 * poder ajustarlos sin tocar código y para los tests. Requiere `trust proxy` (ya está en app.js).
 */
const WINDOW_MS = 15 * 60 * 1000;
const MESSAGE = { error: "Demasiados intentos de inicio de sesión. Esperá unos minutos y volvé a probar." };

const envNumber = (name, fallback) => Number(process.env[name]) || fallback;

const build = ({ limit, keyGenerator }) =>
  rateLimit({
    windowMs: WINDOW_MS,
    limit,
    keyGenerator,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    message: MESSAGE,
  });

const normalizeEmail = (req) => String((req.body && req.body.email) || "").trim().toLowerCase();

// Cada llamada devuelve limitadores con su propio contador (tests aislados).
function createLoginRateLimit() {
  const perAccount = build({
    limit: () => envNumber("LOGIN_RATE_LIMIT_MAX", 5),
    keyGenerator: (req) => `${req.ip}|${normalizeEmail(req)}`,
  });
  const perIp = build({
    limit: () => envNumber("LOGIN_RATE_LIMIT_IP_MAX", 30),
    keyGenerator: (req) => `${req.ip}`,
  });
  return [perAccount, perIp];
}

// Cambio de contraseña propia: 5 fallidos cada 15 min por usuario logueado (va después de verifyToken).
function createPasswordChangeRateLimit() {
  return build({
    limit: () => envNumber("LOGIN_RATE_LIMIT_MAX", 5),
    keyGenerator: (req) => `user:${req.user && req.user.id}`,
  });
}

module.exports = {
  loginRateLimit: createLoginRateLimit(),
  passwordChangeRateLimit: createPasswordChangeRateLimit(),
  createLoginRateLimit,
};
