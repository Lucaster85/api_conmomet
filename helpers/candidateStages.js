"use strict";

/**
 * Etapas de una postulación y el mapa de transiciones (ver FLOWS.md §59). Mismo patrón que
 * `validTransitions` de quoteRequestController.
 *
 * `hired` NO se alcanza desde acá: la contratación convierte al candidato en empleado (etapa 5) y
 * es esa conversión la que pasa la postulación a `hired`. Por eso aparece como destino de `offer`
 * en el mapa (así el mapa describe el recorrido completo) pero `canTransition` lo rechaza cuando
 * se pide a mano — ver `MANUAL_BLOCKED_STAGES`.
 */
const STAGES = ["new", "screening", "interview", "offer", "hired", "rejected", "withdrawn"];

// Etapas en las que la postulación sigue "viva": no es un resultado final.
const OPEN_STAGES = ["new", "screening", "interview", "offer"];

const TRANSITIONS = {
  new: ["screening", "interview", "rejected", "withdrawn"],
  screening: ["interview", "offer", "rejected", "withdrawn"],
  interview: ["offer", "rejected", "withdrawn"],
  offer: ["hired", "rejected", "withdrawn"],
  // Reabrir: vuelve a screening, no a la etapa en la que estaba — la decisión de retomarla es nueva.
  rejected: ["screening"],
  withdrawn: ["screening"],
  hired: [],
};

const MANUAL_BLOCKED_STAGES = ["hired"];

const REJECTION_REASONS = [
  "profile_mismatch",
  "no_vacancies",
  "no_response",
  "failed_interview",
  "salary_expectations",
  "other",
];

function canTransition(from, to) {
  if (MANUAL_BLOCKED_STAGES.includes(to)) return false;
  return (TRANSITIONS[from] || []).includes(to);
}

function isOpenStage(stage) {
  return OPEN_STAGES.includes(stage);
}

module.exports = {
  STAGES,
  OPEN_STAGES,
  TRANSITIONS,
  MANUAL_BLOCKED_STAGES,
  REJECTION_REASONS,
  canTransition,
  isOpenStage,
};
