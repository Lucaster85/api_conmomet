"use strict";

/**
 * Nombre de la empresa en los textos que el backend arma (asunto del mail de invitación, título por
 * defecto de las notificaciones push). Espejo de conmomet-app/src/config/environment.ts: mismas
 * variables, mismas reglas. Sin APP_NAME ni APP_LEGAL_NAME queda "Conmomet", así que producción no
 * configura nada. El servicio del backend de cada ambiente necesita las mismas variables que el del
 * frontend (son servicios de Railway distintos).
 */
const DEFAULT_APP_NAME = "Conmomet";

function getAppName() {
  const appName = (process.env.APP_NAME || "").trim();
  const legalName = (process.env.APP_LEGAL_NAME || "").trim();
  return appName || legalName || DEFAULT_APP_NAME;
}

module.exports = { getAppName, DEFAULT_APP_NAME };
