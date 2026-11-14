"use strict";

/**
 * Vocabulario y validación de las entrevistas de postulantes (ver FLOWS.md §61).
 * Espejo en conmomet-app/src/utils/candidates.ts — si se suma un valor, va en los dos lados.
 */
const MODALITIES = ["in_person", "phone", "video"];
const STATUSES = ["scheduled", "completed", "cancelled", "no_show"];
const RECOMMENDATIONS = ["advance", "hold", "reject"];

const MIN_DURATION = 5;
const MAX_DURATION = 480;

// Etapas en las que tiene sentido agendar: una postulación cerrada (rechazada, retirada, contratada)
// no se entrevista. `offer` sí: puede haber una charla de cierre, y agendarla no la mueve de etapa.
const SCHEDULABLE_STAGES = ["new", "screening", "interview", "offer"];
// Agendar mueve a "interview" solo desde estas: desde "offer" no se vuelve atrás.
const STAGES_THAT_MOVE_TO_INTERVIEW = ["new", "screening"];

const blank = (v) => {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
};

/**
 * Valida los datos de agenda (alta y edición). `partial` (edición): solo valida lo que vino.
 * Devuelve `{ data }` o `{ error }`. `interviewer_ids` se valida aparte (hay que consultar la base).
 */
function parseScheduleBody(body, { partial = false } = {}) {
  const data = {};
  const has = (f) => !partial || body[f] !== undefined;

  if (has("scheduled_at")) {
    const raw = blank(body.scheduled_at);
    const date = raw ? new Date(raw) : null;
    if (!date || Number.isNaN(date.getTime())) return { error: "La fecha y hora de la entrevista no son válidas." };
    data.scheduled_at = date;
  }
  if (has("duration_minutes")) {
    const raw = blank(body.duration_minutes);
    const minutes = raw === null ? 60 : Number(raw);
    if (!Number.isInteger(minutes) || minutes < MIN_DURATION || minutes > MAX_DURATION) {
      return { error: `La duración tiene que estar entre ${MIN_DURATION} y ${MAX_DURATION} minutos.` };
    }
    data.duration_minutes = minutes;
  }
  if (has("modality") && body.modality !== undefined) {
    if (!MODALITIES.includes(body.modality)) return { error: "La modalidad no es válida." };
    data.modality = body.modality;
  }
  if (has("location")) {
    const loc = blank(body.location);
    data.location = loc ? loc.slice(0, 255) : null;
  }
  return { data };
}

function parseResultBody(body) {
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { error: "El puntaje tiene que ser un número de 1 a 5." };
  if (!RECOMMENDATIONS.includes(body.recommendation)) return { error: "Elegí una recomendación." };
  return { data: { rating, recommendation: body.recommendation, feedback: blank(body.feedback) } };
}

module.exports = {
  MODALITIES,
  STATUSES,
  RECOMMENDATIONS,
  SCHEDULABLE_STAGES,
  STAGES_THAT_MOVE_TO_INTERVIEW,
  parseScheduleBody,
  parseResultBody,
};
