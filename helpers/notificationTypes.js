/**
 * Vocabulario de eventos que generan notificación (ver FLOWS.md flujo 37).
 *
 * Lista blanca para que `notify()` no acepte cualquier string: el `type` se usa en el frontend
 * para elegir el ícono de cada fila de la campanita, así que un tipo desconocido se vería como
 * una notificación sin ícono y nadie se enteraría del error.
 *
 * Los primeros cuatro son los que ya mandaban push antes del flujo 37 (ver flujo 28); los otros
 * seis los agregó el flujo 38, cuando los avisos del tablero pasaron a notificar también.
 */
const NOTIFICATION_TYPES = [
  // Eventos de acción: los dispara alguien haciendo click, hay un request en curso (flujos 28/37).
  "quote_request_assigned",
  "quote_request_delivered",
  "quote_request_returned",
  "budget_sent",
  "tool_in_repair_assigned",
  "oca_budget_pending",
  // Eventos de reloj: no los dispara nadie, los dispara el calendario. Los genera el barrido
  // oportunista de services/expirationNotifier.js (flujo 38). Que "por vencer" y "vencido" sean
  // tipos distintos es lo que hace que un documento vuelva a avisar al pasar de uno al otro.
  "document_expiring",
  "document_expired",
  "epp_expiring",
  "epp_expired",
];

function isValidNotificationType(type) {
  return NOTIFICATION_TYPES.includes(type);
}

module.exports = { NOTIFICATION_TYPES, isValidNotificationType };
