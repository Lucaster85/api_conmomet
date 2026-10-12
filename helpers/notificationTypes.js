/**
 * Vocabulario de eventos que generan notificación (ver FLOWS.md flujo 37).
 *
 * Lista blanca para que `notify()` no acepte cualquier string: el `type` se usa en el frontend
 * para elegir el ícono de cada fila de la campanita, así que un tipo desconocido se vería como
 * una notificación sin ícono y nadie se enteraría del error.
 *
 * Son exactamente los eventos que YA mandaban push antes de este flujo (ver flujo 28) — la
 * campanita no agrega disparadores nuevos, persiste los que había. Los avisos de estado del
 * tablero (vencimientos, EPP, OCA, herramientas) siguen sin notificar: eso es la etapa 3.
 */
const NOTIFICATION_TYPES = [
  "quote_request_assigned",
  "quote_request_delivered",
  "quote_request_returned",
  "budget_sent",
];

function isValidNotificationType(type) {
  return NOTIFICATION_TYPES.includes(type);
}

module.exports = { NOTIFICATION_TYPES, isValidNotificationType };
