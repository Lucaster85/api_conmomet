"use strict";
const db = require("../models");
const { uploadToR2, deleteFromR2 } = require("./r2Storage");
const { normalizeCuit, isValidCuit } = require("./cuit");

/**
 * Validación, normalización y manejo de archivos de postulantes, compartidos entre la carga interna
 * (controllers/candidateController.js) y el formulario público "Trabajá con nosotros"
 * (controllers/publicJobApplicationController.js) — ver FLOWS.md §59 y §60.
 */

const FILE_KINDS = ["cv", "cover_letter", "certificate", "other"];
// El alta interna no puede decir "web": ese origen es del formulario público.
const INTERNAL_SOURCES = ["in_person", "referral", "other"];

// ── Validación y normalización ────────────────────────────────────────────────────────────────

const blankToNull = (value) => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
};

const parseBool = (value) => value === true || value === "true" || value === "1" || value === 1;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Convierte el body (JSON o multipart: todo llega como string) en datos listos para guardar, o
 * devuelve `{ error }` con un mensaje para la persona. `partial` (update): solo valida y devuelve
 * los campos que vinieron en el body.
 *
 * dni y cuil se guardan como solo dígitos y como null cuando vienen vacíos — los índices únicos
 * permiten varios NULL pero no varios "".
 */
async function parseCandidateBody(body, { partial = false } = {}) {
  const data = {};
  const has = (field) => !partial || body[field] !== undefined;

  for (const [field, label, max] of [["name", "El nombre", 50], ["lastname", "El apellido", 50]]) {
    if (has(field)) {
      const value = blankToNull(body[field]);
      if (!value) return { error: `${label} es obligatorio.` };
      data[field] = value.slice(0, max);
    }
  }

  if (has("dni")) {
    const dni = blankToNull(body.dni);
    if (dni) {
      const digits = dni.replace(/\D/g, "");
      if (!/^\d{7,8}$/.test(digits)) return { error: "El DNI debe tener 7 u 8 dígitos." };
      data.dni = digits;
    } else data.dni = null;
  }

  if (has("cuil")) {
    const cuil = normalizeCuit(body.cuil);
    if (cuil) {
      if (!isValidCuit(cuil)) return { error: "El CUIL no es válido." };
      data.cuil = cuil;
    } else data.cuil = null;
  }

  if (has("email")) {
    const email = blankToNull(body.email);
    if (email && !EMAIL_RE.test(email)) return { error: "El email no es válido." };
    data.email = email ? email.slice(0, 255) : null;
  }

  if (has("phone")) {
    const phone = blankToNull(body.phone);
    if (phone && phone.replace(/\D/g, "").length < 8) return { error: "El teléfono debe tener al menos 8 dígitos." };
    data.phone = phone ? phone.slice(0, 30) : null;
  }

  if (has("birth_date")) {
    const birth = blankToNull(body.birth_date);
    if (birth) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(birth) || Number.isNaN(new Date(birth).getTime())) {
        return { error: "La fecha de nacimiento no es válida." };
      }
      if (new Date(birth) > new Date()) return { error: "La fecha de nacimiento no puede ser futura." };
      data.birth_date = birth;
    } else data.birth_date = null;
  }

  for (const [field, max] of [["address", 255], ["locality", 100], ["trade", 100]]) {
    if (has(field)) {
      const value = blankToNull(body[field]);
      data[field] = value ? value.slice(0, max) : null;
    }
  }
  if (has("notes")) data.notes = blankToNull(body.notes);

  if (has("years_experience")) {
    const raw = blankToNull(body.years_experience);
    if (raw === null) data.years_experience = null;
    else {
      const years = Number(raw);
      if (!Number.isInteger(years) || years < 0 || years > 70) return { error: "Los años de experiencia deben ser un número entre 0 y 70." };
      data.years_experience = years;
    }
  }

  if (has("has_driver_license")) data.has_driver_license = parseBool(body.has_driver_license);

  if (has("category_id")) {
    const raw = blankToNull(body.category_id);
    if (raw === null) data.category_id = null;
    else {
      const category = await db.Category.findByPk(Number(raw), { attributes: ["id"] });
      if (!category) return { error: "La categoría elegida no existe." };
      data.category_id = category.id;
    }
  }

  if (has("source") && body.source !== undefined) {
    if (!INTERNAL_SOURCES.includes(body.source)) return { error: "El origen no es válido." };
    data.source = body.source;
  }

  if (has("referred_by_employee_id")) {
    const raw = blankToNull(body.referred_by_employee_id);
    if (raw === null) data.referred_by_employee_id = null;
    else {
      const employee = await db.Employee.findByPk(Number(raw), { attributes: ["id"] });
      if (!employee) return { error: "El empleado que lo recomendó no existe." };
      data.referred_by_employee_id = employee.id;
    }
  }

  return { data };
}

// Los archivos viajan en `files` y su tipo en `file_kinds` (array JSON en el mismo orden). Un tipo
// faltante o desconocido cae en "other": no tiene sentido rechazar el alta por eso.
function parseFileKinds(raw, count) {
  let kinds = [];
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) kinds = parsed;
  } catch {
    kinds = [];
  }
  return Array.from({ length: count }, (_, i) => (FILE_KINDS.includes(kinds[i]) ? kinds[i] : "other"));
}

function uniqueConstraintMessage(error) {
  if (error.name !== "SequelizeUniqueConstraintError") return null;
  const field = error.errors?.[0]?.path || "";
  if (field.includes("dni")) return "Ya existe un postulante con ese DNI.";
  if (field.includes("cuil")) return "Ya existe un postulante con ese CUIL.";
  if (field.includes("employee")) return "Ese empleado ya está vinculado a otro postulante.";
  return "Ya existe un postulante con esos datos.";
}

async function writeLog({ applicationId, event, fromStage = null, toStage = null, comment = null, changedBy = null }, transaction) {
  return db.CandidateApplicationLog.create(
    {
      application_id: applicationId,
      event,
      from_stage: fromStage,
      to_stage: toStage,
      comment: comment ? String(comment).trim() : null,
      changed_by: changedBy,
      changed_at: new Date(),
    },
    { transaction }
  );
}

// Sube los archivos a R2 y crea sus filas. Devuelve las URLs subidas para que quien llama las
// borre del bucket si después falla la transacción (un archivo huérfano en R2 no se ve desde ningún lado).
async function storeFiles({ files, kinds, candidateId, applicationId, userId, transaction, uploadedUrls }) {
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const fileUrl = await uploadToR2(file, `candidates/${candidateId}`);
    uploadedUrls.push(fileUrl);
    await db.CandidateFile.create(
      {
        candidate_id: candidateId,
        application_id: applicationId || null,
        kind: kinds[i],
        file_url: fileUrl,
        file_key: fileUrl.replace(`${process.env.STORAGE_PUBLIC_URL}/`, ""),
        file_name: file.originalname,
        mime_type: file.mimetype,
        size_bytes: file.size,
        uploaded_by: userId || null,
      },
      { transaction }
    );
  }
}

const cleanupUploads = (urls) => Promise.all(urls.map((url) => deleteFromR2(url).catch(() => null)));

module.exports = {
  FILE_KINDS,
  INTERNAL_SOURCES,
  blankToNull,
  parseBool,
  parseCandidateBody,
  parseFileKinds,
  uniqueConstraintMessage,
  writeLog,
  storeFiles,
  cleanupUploads,
};
