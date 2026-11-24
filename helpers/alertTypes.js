/**
 * Los tipos de aviso del tablero que aceptan acuse de vista (ver FLOWS.md flujo 36).
 *
 * Lista blanca a propósito: `POST /me/alert-views` lo puede llamar cualquier usuario autenticado
 * (vive en el namespace /me/*, sin authPermission), así que sin validar `alert_type` cualquiera
 * podría llenar la tabla con filas basura que nunca se leen ni se podan.
 *
 * El `entity_id` de cada tipo y la `revision` que le corresponde están documentados en FLOWS.md
 * flujo 36 — acá no hace falta saberlo: el backend trata la revisión como un string opaco.
 */
const ALERT_TYPES = [
  "quote_request",
  "entity_document",
  "oca_budget",
  "safety_equipment",
  "tool_in_repair",
  "salary_advance_deletion",
  "loan_change",
  "termination_agreement",
  "additional_pending_budget",
  "budget_awaiting_response",
  "contact_inquiry",
  "candidate_application",
  "candidate_interview",
  // Presupuestos aprobados que todavía no tienen OC del cliente cargada y no están marcados "no lleva OC" (flujo 69).
  "budget_without_purchase_order",
  // Cauciones por vencer o vencidas (flujo 69).
  "surety_bond",
  // FCE rechazadas por el cliente sin nota de crédito de anulación emitida, y FCE aceptadas con opción ADC todavía sin informar al ADC (flujo 78).
  "fce_rejected",
  "fce_adc_pending",
];

function isValidAlertType(alertType) {
  return ALERT_TYPES.includes(alertType);
}

module.exports = { ALERT_TYPES, isValidAlertType };
