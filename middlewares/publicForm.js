"use strict";
const rateLimit = require("express-rate-limit");

/**
 * Infra común de los formularios públicos (sin usuario) que escriben en la base — hoy
 * `POST /public/contact`, y en la etapa 3 `POST /public/job-applications` (ver FLOWS.md §58).
 *
 * Antes de esto no había ninguna defensa: cualquiera podía llenar la tabla con basura. Son dos
 * defensas baratas y sin dependencias externas (nada de captcha por ahora, ver "Futuro" del plan):
 * un tope de envíos por IP y un campo trampa que los bots completan y las personas no ven.
 */

const DEFAULT_MAX = 5;
const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

const GENERIC_OK = { message: "Mensaje enviado correctamente." };

/**
 * Tope de envíos por IP. Cada llamada devuelve un limitador con su PROPIO contador, así que el
 * límite es "por IP y por ruta": mandar una consulta no gasta los envíos de "Trabajá con nosotros".
 *
 * El máximo se lee en cada request (no al cargar el módulo) para poder ajustarlo por variable de
 * entorno sin tocar código, y para que los tests lo puedan subir o bajar. Requiere
 * `app.set('trust proxy', 1)`: detrás del proxy de Railway, sin eso todas las IP serían la misma.
 */
function publicRateLimit({ windowMs = DEFAULT_WINDOW_MS } = {}) {
  return rateLimit({
    windowMs,
    limit: () => Number(process.env.PUBLIC_FORM_RATE_LIMIT_MAX) || DEFAULT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Demasiados envíos desde tu conexión. Probá de nuevo en unos minutos." },
  });
}

/**
 * Campo trampa: el formulario lo incluye oculto (fuera de pantalla, sin foco ni autocompletado).
 * Una persona nunca lo completa; un bot que llena todo lo que encuentra, sí. Si viene con algo se
 * responde un 200 IGUAL al de un envío válido —el bot no se entera de que fue detectado— y no se
 * guarda ni se avisa nada.
 */
function honeypot(field) {
  return (req, res, next) => {
    const value = req.body && req.body[field];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return res.status(200).json(GENERIC_OK);
    }
    next();
  };
}

module.exports = { publicRateLimit, honeypot, GENERIC_OK };
