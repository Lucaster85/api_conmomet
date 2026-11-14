const db = require("../models");
const { notifyByPermission } = require("../helpers/notificationService");
const { GENERIC_OK } = require("../middlewares/publicForm");
const { findExistingCandidate } = require("../helpers/candidateMatching");
const { OPEN_STAGES } = require("../helpers/candidateStages");
const {
  blankToNull,
  parseCandidateBody,
  parseFileKinds,
  uniqueConstraintMessage,
  writeLog,
  storeFiles,
  cleanupUploads,
} = require("../helpers/candidateData");

/**
 * POST /public/job-applications — "Trabajá con nosotros" (ver FLOWS.md §60). Sin usuario: pasa antes
 * por publicRateLimit, el upload de CV y el honeypot (routes/index.js).
 *
 * Qué NO se toma del body aunque venga: origen, categoría, notas, a quién recomienda, etapa. El
 * formulario público solo decide los datos de la persona y lo que quiere contar; el resto lo pone el
 * servidor (`source: web`) o lo completa después alguien de Personal.
 */

// Versión del texto de privacidad que la persona aceptó (Ley 25.326). Si se cambia el texto del
// formulario, se sube esta versión: queda guardado qué leyó cada uno al aceptar.
const CONSENT_VERSION = "2026-11";

const PUBLIC_FIELDS = ["name", "lastname", "dni", "email", "phone", "birth_date", "locality", "trade", "years_experience", "has_driver_license"];
// En la web solo hay CV y carta adjunta; cualquier otro tipo cae en "other".
const PUBLIC_KINDS = ["cv", "cover_letter"];

const SUCCESS = { message: "Recibimos tu postulación. Si tu perfil coincide con lo que buscamos, nos vamos a comunicar con vos." };

const pick = (source, fields) => Object.fromEntries(fields.filter((f) => source[f] !== undefined).map((f) => [f, source[f]]));

// Los datos de la persona que NO estaban cargados se completan; los que ya tenían valor no se pisan.
// `has_driver_license` queda afuera a propósito: "false" es el valor por defecto, no un dato vacío, y
// no se puede distinguir "no lo cargaron" de "no tiene".
function fillEmptyFields(candidate, data) {
  const patch = {};
  for (const [field, value] of Object.entries(data)) {
    if (field === "has_driver_license") continue;
    const current = candidate[field];
    const isEmpty = current === null || current === undefined || current === "";
    if (isEmpty && value !== null && value !== undefined && value !== "") patch[field] = value;
  }
  return patch;
}

async function processSubmission({ req, data, kinds, files, coverLetter, snapshot }) {
  const uploadedUrls = [];
  const transaction = await db.sequelize.transaction();
  try {
    const consent = { consent_accepted_at: new Date(), consent_version: CONSENT_VERSION, consent_ip: blankToNull(req.ip)?.slice(0, 64) || null };
    let candidate = await findExistingCandidate({ dni: data.dni, email: data.email, phone: data.phone });
    let resubmitted = false;
    let ignored = false;

    if (candidate) {
      // Ya es empleado (conversión de la etapa 5): no hay nada que postular.
      if (candidate.employee_id) {
        ignored = true;
      } else {
        // El consentimiento sí se actualiza: es el registro de lo último que aceptó, no un dato de perfil.
        await candidate.update({ ...fillEmptyFields(candidate, data), ...consent }, { transaction });
        const open = await db.CandidateApplication.findOne({
          where: { candidate_id: candidate.id, stage: OPEN_STAGES },
          order: [["id", "DESC"]],
          transaction,
        });
        if (open) {
          resubmitted = true;
          const previous = open.submitted_data || {};
          await open.update(
            { submitted_data: { ...previous, resubmissions: [...(previous.resubmissions || []), { at: new Date().toISOString(), ...snapshot }] } },
            { transaction }
          );
          await writeLog(
            { applicationId: open.id, event: "resubmitted", toStage: open.stage, comment: coverLetter || `Volvió a enviar su CV (${files.length} ${files.length === 1 ? "archivo" : "archivos"}).` },
            transaction
          );
          await storeFiles({ files, kinds, candidateId: candidate.id, applicationId: open.id, userId: null, transaction, uploadedUrls });
        }
        if (!open) {
          const application = await db.CandidateApplication.create(
            {
              candidate_id: candidate.id,
              stage: "new",
              position_of_interest: data.trade || candidate.trade || null,
              cover_letter: coverLetter,
              source: "web",
              applied_at: new Date(),
              submitted_data: snapshot,
            },
            { transaction }
          );
          await writeLog({ applicationId: application.id, event: "created", toStage: "new" }, transaction);
          await storeFiles({ files, kinds, candidateId: candidate.id, applicationId: application.id, userId: null, transaction, uploadedUrls });
        }
      }
    } else {
      candidate = await db.Candidate.create({ ...data, source: "web", created_by: null, ...consent }, { transaction });
      const application = await db.CandidateApplication.create(
        {
          candidate_id: candidate.id,
          stage: "new",
          position_of_interest: data.trade || null,
          cover_letter: coverLetter,
          source: "web",
          applied_at: new Date(),
          submitted_data: snapshot,
        },
        { transaction }
      );
      await writeLog({ applicationId: application.id, event: "created", toStage: "new" }, transaction);
      await storeFiles({ files, kinds, candidateId: candidate.id, applicationId: application.id, userId: null, transaction, uploadedUrls });
    }

    await transaction.commit();
    return { candidate, resubmitted, ignored };
  } catch (error) {
    await transaction.rollback();
    await cleanupUploads(uploadedUrls);
    throw error;
  }
}

module.exports = {
  CONSENT_VERSION,

  submit: async (req, res) => {
    const body = req.body || {};
    const files = req.files || [];

    if (!["true", "1", true].includes(body.consent)) {
      return res.status(400).json({ error: "Tenés que aceptar el tratamiento de tus datos personales para postularte." });
    }

    const parsed = await parseCandidateBody(pick(body, PUBLIC_FIELDS));
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const data = parsed.data;
    if (!data.dni) return res.status(400).json({ error: "El DNI es obligatorio." });
    if (!data.email && !data.phone) {
      return res.status(400).json({ error: "Dejanos un teléfono o un email para poder comunicarnos con vos." });
    }

    const kinds = parseFileKinds(body.file_kinds, files.length).map((k) => (PUBLIC_KINDS.includes(k) ? k : "other"));
    if (!kinds.includes("cv")) {
      return res.status(400).json({ error: "Adjuntá tu CV." });
    }

    const coverLetter = blankToNull(body.cover_letter)?.slice(0, 5000) || null;
    // Lo que mandó la persona, tal cual, aunque después se completen o corrijan sus datos.
    const snapshot = {
      ...data,
      cover_letter: coverLetter,
      files: files.map((f, i) => ({ name: f.originalname, kind: kinds[i], size: f.size })),
    };

    // Dos envíos simultáneos con el mismo DNI chocan en el índice único del segundo `create`: se
    // reintenta una vez, y esta vez `findExistingCandidate` encuentra al que acaba de crearse.
    let result = null;
    for (let attempt = 0; attempt < 2 && !result; attempt += 1) {
      try {
        result = await processSubmission({ req, data, kinds, files, coverLetter, snapshot });
      } catch (error) {
        if (!uniqueConstraintMessage(error) || attempt === 1) {
          console.error("[job-applications] no se pudo guardar la postulación:", error.message);
          return res.status(500).json({ error: "No pudimos enviar tu postulación. Probá de nuevo en unos minutos." });
        }
      }
    }

    if (!result.ignored) {
      const { candidate, resubmitted } = result;
      // Fire-and-forget: el aviso no puede romper el envío, la postulación ya se guardó.
      notifyByPermission("candidates_read", {
        type: "job_application_received",
        title: resubmitted ? "Postulante volvió a enviar su CV" : "Nueva postulación web",
        body: `${candidate.name} ${candidate.lastname}${data.trade ? ` — ${data.trade}` : ""}`,
        url: `/dashboard/candidates/${candidate.id}`,
        tag: `candidate-${candidate.id}`,
        entity: { type: "candidate", id: candidate.id },
      });
    }

    // Misma respuesta en todos los casos: no se le dice a un visitante anónimo si ya estaba cargado.
    return res.status(200).json(SUCCESS);
  },
};
