"use strict";
const { randomUUID } = require("crypto");

/**
 * Respuesta única para los errores inesperados (500). FLOWS.md §75.3.
 *
 * Hasta ahora cada catch hacía `res.status(500).json({ error: error.message })`, y el mensaje de un
 * error de Sequelize, de red o del SDK de R2 muestra SQL, nombres de tabla, hosts y rutas.
 *  - Error de NEGOCIO (`error.constructor === Error`, sin `sql` ni `$metadata`; ej. los
 *    `throw new Error("…")` en español o `fail(msg, status)`): se devuelve `{ error: message }`
 *    como siempre, para no perder los mensajes que ve el usuario.
 *  - Cualquier otro (SequelizeError, TypeError, errores del SDK, de red, etc.): se loguea completo
 *    con una referencia corta y se responde 500 genérico con esa referencia, para que
 *    administración la pueda buscar en el log.
 */
const isBusinessError = (error) =>
  error instanceof Error &&
  error.constructor === Error &&
  error.sql === undefined &&
  error.$metadata === undefined;

function sendServerError(res, error) {
  if (isBusinessError(error)) {
    return res.status(500).json({ error: error.message });
  }
  const ref = randomUUID().slice(0, 8);
  console.error(`[internal_error ref=${ref}]`, error);
  return res.status(500).json({
    error: `Ocurrió un error interno. Si se repite, avisá al administrador (ref. ${ref}).`,
    code: "internal_error",
    ref,
  });
}

module.exports = { sendServerError, isBusinessError };
