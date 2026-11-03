"use strict";
// Reglas puras (sin DB) del egreso de empleados: validación y normalización de los campos
// del trámite, plazos legales y avisos. Ver PLAN_EGRESOS.md §1, §3 y §4.

const TERMINATION_TYPES = ["resignation", "dismissal_with_cause", "dismissal_without_cause", "mutual_agreement"];
const NOTICE_GIVEN = ["none", "full", "partial"];

// Nombres de las categorías sembradas por la migración 20261103100003. Los avisos de documentos
// faltantes buscan la categoría por nombre.
const TERMINATION_DOCUMENT_CATEGORIES = {
  resignation: "Telegrama de renuncia",
  dismissal: "Telegrama / carta documento de despido",
  mutual_agreement: "Acta / escritura de mutuo acuerdo",
};

const PAYMENT_DEADLINE_BUSINESS_DAYS = 4; // arts. 128 y 255 bis LCT
const ART80_DEADLINE_DAYS = 30; // art. 80 LCT

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isIsoDate = (value) => {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};

const toUtcDate = (iso) => new Date(`${iso}T00:00:00Z`);
const toIso = (date) => date.toISOString().slice(0, 10);

const addDays = (iso, days) => {
  const d = toUtcDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
};

/**
 * Suma `n` días hábiles (lunes a viernes, sin feriados) a partir del día siguiente a `iso`.
 * @param {string} iso - YYYY-MM-DD
 * @param {number} n
 * @param {Set<string>|string[]} holidays - fechas YYYY-MM-DD no laborables
 */
const addBusinessDays = (iso, n, holidays = []) => {
  const holidaySet = holidays instanceof Set ? holidays : new Set(holidays);
  let current = iso;
  let remaining = n;
  while (remaining > 0) {
    current = addDays(current, 1);
    const dow = toUtcDate(current).getUTCDay();
    if (dow === 0 || dow === 6 || holidaySet.has(current)) continue;
    remaining -= 1;
  }
  return current;
};

const paymentDeadline = (terminationDate, holidays) =>
  addBusinessDays(terminationDate, PAYMENT_DEADLINE_BUSINESS_DAYS, holidays);

const art80Deadline = (terminationDate) => addDays(terminationDate, ART80_DEADLINE_DAYS);

const blankToNull = (v) => (v === undefined || v === null || v === "" ? null : v);

/**
 * Valida y normaliza los campos editables del egreso. `input` es el body (o el body mezclado con
 * lo ya guardado, al editar). Devuelve `{ errors, values }`; si hay errores, `values` no sirve.
 * Los campos que no corresponden al tipo se limpian (ej: preaviso en una renuncia), así el
 * registro nunca guarda una combinación incoherente.
 */
const normalizeTerminationFields = (input, { hireDate } = {}) => {
  const errors = [];
  const values = {};

  const type = input.type;
  if (!TERMINATION_TYPES.includes(type)) {
    errors.push("El tipo de egreso es obligatorio (renuncia, despido con causa, despido sin causa o mutuo acuerdo).");
  }
  values.type = type;

  const dateField = (key, label, { required = false } = {}) => {
    const v = blankToNull(input[key]);
    if (v === null) {
      if (required) errors.push(`${label} es obligatoria.`);
      values[key] = null;
      return;
    }
    if (!isIsoDate(v)) {
      errors.push(`${label} no es una fecha válida.`);
      values[key] = null;
      return;
    }
    values[key] = v;
  };

  dateField("termination_date", "La fecha de egreso", { required: true });
  dateField("notice_date", "La fecha de la comunicación");
  dateField("art80_delivered_at", "La fecha de entrega del certificado de trabajo");

  if (values.termination_date && hireDate && values.termination_date < hireDate) {
    errors.push("La fecha de egreso no puede ser anterior a la fecha de ingreso del empleado.");
  }

  // Preaviso de la empresa: solo despido sin causa.
  if (type === "dismissal_without_cause") {
    const given = blankToNull(input.notice_given) || "none";
    if (!NOTICE_GIVEN.includes(given)) {
      errors.push("El preaviso debe ser: ninguno, completo o parcial.");
    }
    values.notice_given = given;
    if (given === "none") {
      values.notice_start_date = null;
      values.notice_end_date = null;
    } else {
      dateField("notice_start_date", "La fecha de inicio del preaviso");
      dateField("notice_end_date", "La fecha de fin del preaviso");
      if (values.notice_start_date && values.notice_end_date && values.notice_end_date < values.notice_start_date) {
        errors.push("El fin del preaviso no puede ser anterior a su inicio.");
      }
    }
  } else {
    values.notice_given = "none";
    values.notice_start_date = null;
    values.notice_end_date = null;
  }

  // Causa: obligatoria en despido con causa (art. 243: tiene que estar por escrito y no cambia).
  const cause = typeof input.cause_description === "string" ? input.cause_description.trim() : "";
  if (type === "dismissal_with_cause") {
    if (!cause) errors.push("La causa del despido es obligatoria.");
    values.cause_description = cause || null;
  } else {
    values.cause_description = cause || null;
  }

  // 15 días de preaviso del trabajador: solo renuncia.
  values.employee_notice_omitted =
    type === "resignation" && (input.employee_notice_omitted === true || input.employee_notice_omitted === "true");

  // Tope del art. 245: solo tiene sentido en despido sin causa (y como referencia en mutuo acuerdo).
  const cap = blankToNull(input.cct_cap_amount);
  if (cap === null || (type !== "dismissal_without_cause" && type !== "mutual_agreement")) {
    values.cct_cap_amount = null;
  } else if (!Number.isFinite(Number(cap)) || Number(cap) < 0) {
    errors.push("El tope del convenio debe ser un monto mayor o igual a cero.");
    values.cct_cap_amount = null;
  } else {
    values.cct_cap_amount = Number(cap);
  }

  values.notes = blankToNull(input.notes);

  return { errors, values };
};

/**
 * Avisos del egreso (no bloquean nada). `documents` trae, por cada papel cargado, el nombre de
 * su categoría: `[{ category_name }]`.
 */
const buildWarnings = ({ termination, documents = [], today }) => {
  if (!termination || termination.status === "cancelled") return [];
  const warnings = [];
  const categoryNames = new Set(documents.map((d) => d.category_name).filter(Boolean));

  if (termination.type === "resignation" && !categoryNames.has(TERMINATION_DOCUMENT_CATEGORIES.resignation)) {
    warnings.push({
      code: "missing_resignation_letter",
      message: "Falta cargar el telegrama de renuncia: la renuncia solo es válida por telegrama o ante autoridad (art. 240).",
    });
  }
  if (termination.type === "dismissal_with_cause" && !categoryNames.has(TERMINATION_DOCUMENT_CATEGORIES.dismissal)) {
    warnings.push({
      code: "missing_dismissal_letter",
      message: "Falta cargar el telegrama o carta documento de despido: la causa tiene que estar por escrito (art. 243).",
    });
  }
  if (termination.type === "mutual_agreement" && !categoryNames.has(TERMINATION_DOCUMENT_CATEGORIES.mutual_agreement)) {
    warnings.push({
      code: "missing_mutual_agreement_act",
      message: "Falta cargar el acta o escritura del mutuo acuerdo: tiene que formalizarse ante escribano o autoridad (art. 241).",
    });
  }

  // El certificado del art. 80 corre desde el egreso: solo aplica cuando el egreso ya rige.
  if (termination.status !== "draft" && !termination.art80_delivered_at && termination.termination_date) {
    const deadline = art80Deadline(termination.termination_date);
    if (today && today > deadline) {
      warnings.push({
        code: "art80_overdue",
        message: `El certificado de trabajo (art. 80) debió entregarse hasta el ${deadline}.`,
      });
    }
  }

  return warnings;
};

module.exports = {
  TERMINATION_TYPES,
  NOTICE_GIVEN,
  TERMINATION_DOCUMENT_CATEGORIES,
  PAYMENT_DEADLINE_BUSINESS_DAYS,
  ART80_DEADLINE_DAYS,
  isIsoDate,
  addDays,
  addBusinessDays,
  paymentDeadline,
  art80Deadline,
  normalizeTerminationFields,
  buildWarnings,
};
