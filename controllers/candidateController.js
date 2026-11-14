const { Op } = require("sequelize");
const db = require("../models");
const { uploadToR2, deleteFromR2 } = require("../helpers");
const { normalizeCuit, isValidCuit } = require("../helpers/cuit");
const {
  STAGES,
  REJECTION_REASONS,
  canTransition,
  isOpenStage,
  OPEN_STAGES,
} = require("../helpers/candidateStages");
const { findEmployeeMatches, findCandidateDuplicates } = require("../helpers/candidateMatching");

/**
 * Postulantes (/candidates): la PERSONA que se presenta a trabajar (Candidate) y sus postulaciones
 * (CandidateApplication), con sus papeles (CandidateFile) y el historial de etapas. Esta etapa es la
 * carga interna desde el dashboard; el formulario público "Trabajá con nosotros" y la conversión en
 * empleado vienen en etapas siguientes. Ver FLOWS.md §59.
 */

const FILE_KINDS = ["cv", "cover_letter", "certificate", "other"];
// El alta interna no puede decir "web": ese origen es del formulario público.
const INTERNAL_SOURCES = ["in_person", "referral", "other"];

const userAttrs = ["id", "name", "lastname"];

const detailInclude = [
  { model: db.CandidateApplication, as: "applications" },
  { model: db.CandidateFile, as: "files", include: [{ model: db.User, as: "uploader", attributes: userAttrs }] },
  { model: db.Category, as: "category", attributes: ["id", "name"] },
  { model: db.Employee, as: "employee", attributes: ["id", "name", "lastname"], paranoid: false },
  { model: db.Employee, as: "referredBy", attributes: ["id", "name", "lastname"], paranoid: false },
  { model: db.User, as: "createdByUser", attributes: userAttrs },
];
const detailOrder = [
  [{ model: db.CandidateApplication, as: "applications" }, "applied_at", "DESC"],
  [{ model: db.CandidateApplication, as: "applications" }, "id", "DESC"],
  [{ model: db.CandidateFile, as: "files" }, "id", "ASC"],
];

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

async function loadDetail(id) {
  const candidate = await db.Candidate.findByPk(id, { include: detailInclude, order: detailOrder });
  if (!candidate) return null;
  // Se calculan al leer (ver helpers/candidateMatching.js). El empleado al que ESTE candidato ya fue
  // convertido no cuenta como "ya es empleado": es justamente el resultado de la conversión.
  const matches = await findEmployeeMatches({
    dni: candidate.dni,
    cuil: candidate.cuil,
    exceptEmployeeId: candidate.employee_id,
  });
  return {
    ...candidate.toJSON(),
    former_employee: matches.former[0] || null,
    current_employee: matches.current[0] || null,
  };
}

// EXISTS sobre las postulaciones, para filtrar en SQL (el listado no pagina, pero el criterio de
// "abierto" no tiene por qué vivir en memoria). Solo se interpolan constantes del código.
const stageList = (stages) => stages.map((s) => `'${s}'`).join(",");
const HAS_OPEN_APPLICATION = `EXISTS (SELECT 1 FROM CandidateApplications ca WHERE ca.candidate_id = Candidate.id AND ca.stage IN (${stageList(OPEN_STAGES)}))`;
const HAS_NO_APPLICATION = "NOT EXISTS (SELECT 1 FROM CandidateApplications ca WHERE ca.candidate_id = Candidate.id)";

module.exports = {
  // GET /candidates?q=&stage=&source=&include_closed=
  // "Ocultar cerrados" (FLOWS.md §52): por defecto solo aparecen los postulantes con una postulación
  // abierta (o sin ninguna). Uno cuyas postulaciones están todas rechazadas, retiradas o contratadas
  // se ve con `include_closed`. Una etapa explícita le gana al "ocultar".
  getAll: async (req, res) => {
    try {
      const { q, stage, source, include_closed } = req.query;
      const and = [];

      if (stage && STAGES.includes(stage)) {
        and.push(db.Sequelize.literal(`EXISTS (SELECT 1 FROM CandidateApplications ca WHERE ca.candidate_id = Candidate.id AND ca.stage = '${stage}')`));
      } else if (include_closed !== "true") {
        and.push({ [Op.or]: [db.Sequelize.literal(HAS_OPEN_APPLICATION), db.Sequelize.literal(HAS_NO_APPLICATION)] });
      }

      if (source && ["web", "in_person", "referral", "other"].includes(source)) and.push({ source });

      if (q) {
        const like = `%${q}%`;
        and.push({
          [Op.or]: [
            { name: { [Op.like]: like } },
            { lastname: { [Op.like]: like } },
            { dni: { [Op.like]: like } },
            { cuil: { [Op.like]: like } },
            { email: { [Op.like]: like } },
            { phone: { [Op.like]: like } },
            { trade: { [Op.like]: like } },
            db.Sequelize.where(db.Sequelize.fn("CONCAT", db.Sequelize.col("Candidate.name"), " ", db.Sequelize.col("Candidate.lastname")), { [Op.like]: like }),
          ],
        });
      }

      const candidates = await db.Candidate.findAll({
        where: and.length ? { [Op.and]: and } : {},
        attributes: {
          include: [[db.Sequelize.literal("(SELECT COUNT(*) FROM CandidateFiles cf WHERE cf.candidate_id = Candidate.id AND cf.deleted_at IS NULL)"), "files_count"]],
        },
        include: [
          { model: db.CandidateApplication, as: "applications", attributes: ["id", "stage", "position_of_interest", "applied_at", "source"] },
          { model: db.Category, as: "category", attributes: ["id", "name"] },
        ],
        order: [["id", "DESC"], [{ model: db.CandidateApplication, as: "applications" }, "applied_at", "DESC"]],
      });
      return res.status(200).json({ data: candidates });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  getById: async (req, res) => {
    try {
      const data = await loadDetail(req.params.id);
      if (!data) return res.status(404).json({ error: "Postulante no encontrado." });
      return res.status(200).json({ data });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // GET /candidates/check-duplicates?dni=&cuil=&email=&phone=&exclude_id=
  // Alimenta el aviso en vivo del alta: otros postulantes que podrían ser la misma persona, y si el
  // DNI/CUIL ya es de un empleado actual o de un ex-empleado. No bloquea nada: avisa.
  checkDuplicates: async (req, res) => {
    try {
      const dni = blankToNull(req.query.dni)?.replace(/\D/g, "") || null;
      const cuil = normalizeCuit(req.query.cuil);
      const email = blankToNull(req.query.email);
      const phone = blankToNull(req.query.phone);
      const excludeId = parseInt(req.query.exclude_id, 10) || null;

      const [candidates, employees] = await Promise.all([
        findCandidateDuplicates({ dni, cuil, email, phone, excludeId }),
        findEmployeeMatches({ dni, cuil }),
      ]);
      return res.status(200).json({ data: { candidates, current_employees: employees.current, former_employees: employees.former } });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // POST /candidates (multipart: campos + `files` + `file_kinds`). Candidato + postulación inicial +
  // papeles en UNA transacción, con origen "presencial" (o recomendado/otro). Si algo falla, no queda
  // nada a medias en la base ni archivos huérfanos en el bucket.
  create: async (req, res) => {
    const files = req.files || [];
    const parsed = await parseCandidateBody(req.body || {});
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const kinds = parseFileKinds(req.body.file_kinds, files.length);
    const uploadedUrls = [];
    const transaction = await db.sequelize.transaction();
    try {
      const candidate = await db.Candidate.create(
        { ...parsed.data, source: parsed.data.source || "in_person", created_by: req.user.id },
        { transaction }
      );
      const application = await db.CandidateApplication.create(
        {
          candidate_id: candidate.id,
          stage: "new",
          position_of_interest: blankToNull(req.body.position_of_interest)?.slice(0, 100) || candidate.trade,
          cover_letter: blankToNull(req.body.cover_letter),
          source: candidate.source,
          applied_at: new Date(),
          created_by: req.user.id,
        },
        { transaction }
      );
      await writeLog({ applicationId: application.id, event: "created", toStage: "new", changedBy: req.user.id }, transaction);
      await storeFiles({ files, kinds, candidateId: candidate.id, applicationId: application.id, userId: req.user.id, transaction, uploadedUrls });

      await transaction.commit();
      return res.status(201).json({ data: await loadDetail(candidate.id) });
    } catch (error) {
      await transaction.rollback();
      await cleanupUploads(uploadedUrls);
      const message = uniqueConstraintMessage(error);
      if (message) return res.status(400).json({ error: message });
      return res.status(500).json({ error: error.message });
    }
  },

  // PUT /candidates/:id — datos de la persona. La etapa se cambia aparte (changeStage).
  update: async (req, res) => {
    try {
      const candidate = await db.Candidate.findByPk(req.params.id);
      if (!candidate) return res.status(404).json({ error: "Postulante no encontrado." });

      const parsed = await parseCandidateBody(req.body || {}, { partial: true });
      if (parsed.error) return res.status(400).json({ error: parsed.error });

      await candidate.update(parsed.data);
      return res.status(200).json({ data: await loadDetail(candidate.id) });
    } catch (error) {
      const message = uniqueConstraintMessage(error);
      if (message) return res.status(400).json({ error: message });
      return res.status(500).json({ error: error.message });
    }
  },

  // DELETE /candidates/:id — borrado REAL (no soft delete) más sus papeles del bucket. Es un dato
  // personal (Ley 25.326): si la persona pide que la borren, tiene que desaparecer de verdad. Las
  // postulaciones, los papeles y el historial se van en cascada por las FK.
  destroy: async (req, res) => {
    try {
      const candidate = await db.Candidate.findByPk(req.params.id);
      if (!candidate) return res.status(404).json({ error: "Postulante no encontrado." });
      if (candidate.employee_id) {
        return res.status(400).json({ error: "Este postulante ya fue dado de alta como empleado: no se puede eliminar." });
      }

      // Con paranoid:false para alcanzar también los papeles que ya se borraron "suave".
      const files = await db.CandidateFile.findAll({ where: { candidate_id: candidate.id }, paranoid: false });
      await candidate.destroy({ force: true });
      await cleanupUploads(files.map((f) => f.file_url));
      return res.status(200).json({ message: "Postulante eliminado." });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // POST /candidates/:id/files (multipart: `files` + `file_kinds`, opcional `application_id`).
  addFiles: async (req, res) => {
    const files = req.files || [];
    const uploadedUrls = [];
    try {
      const candidate = await db.Candidate.findByPk(req.params.id, { attributes: ["id"] });
      if (!candidate) return res.status(404).json({ error: "Postulante no encontrado." });
      if (files.length === 0) return res.status(400).json({ error: "Adjuntá al menos un archivo." });

      let applicationId = null;
      if (req.body.application_id) {
        const application = await db.CandidateApplication.findOne({ where: { id: Number(req.body.application_id), candidate_id: candidate.id }, attributes: ["id"] });
        if (!application) return res.status(400).json({ error: "La postulación indicada no pertenece a este postulante." });
        applicationId = application.id;
      }

      const transaction = await db.sequelize.transaction();
      try {
        await storeFiles({
          files,
          kinds: parseFileKinds(req.body.file_kinds, files.length),
          candidateId: candidate.id,
          applicationId,
          userId: req.user.id,
          transaction,
          uploadedUrls,
        });
        await transaction.commit();
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
      return res.status(200).json({ data: await loadDetail(candidate.id) });
    } catch (error) {
      await cleanupUploads(uploadedUrls);
      return res.status(500).json({ error: error.message });
    }
  },

  removeFile: async (req, res) => {
    try {
      const file = await db.CandidateFile.findOne({ where: { id: req.params.fileId, candidate_id: req.params.id } });
      if (!file) return res.status(404).json({ error: "Archivo no encontrado." });

      await deleteFromR2(file.file_url);
      await file.destroy();
      return res.status(200).json({ data: await loadDetail(req.params.id) });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // POST /candidates/:id/applications — una postulación nueva de una persona que ya existe (vuelve a
  // presentarse). Una sola abierta a la vez: dos en paralelo no tienen sentido y ensucian el listado.
  createApplication: async (req, res) => {
    try {
      const candidate = await db.Candidate.findByPk(req.params.id);
      if (!candidate) return res.status(404).json({ error: "Postulante no encontrado." });
      if (candidate.employee_id) {
        return res.status(400).json({ error: "Este postulante ya fue dado de alta como empleado." });
      }
      const open = await db.CandidateApplication.count({ where: { candidate_id: candidate.id, stage: { [Op.in]: OPEN_STAGES } } });
      if (open > 0) return res.status(400).json({ error: "Este postulante ya tiene una postulación abierta." });

      const transaction = await db.sequelize.transaction();
      try {
        const application = await db.CandidateApplication.create(
          {
            candidate_id: candidate.id,
            stage: "new",
            position_of_interest: blankToNull(req.body?.position_of_interest)?.slice(0, 100) || candidate.trade,
            cover_letter: blankToNull(req.body?.cover_letter),
            source: INTERNAL_SOURCES.includes(req.body?.source) ? req.body.source : "in_person",
            applied_at: new Date(),
            created_by: req.user.id,
          },
          { transaction }
        );
        await writeLog({ applicationId: application.id, event: "created", toStage: "new", changedBy: req.user.id }, transaction);
        await transaction.commit();
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
      return res.status(201).json({ data: await loadDetail(candidate.id) });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // PUT /candidates/:id/applications/:applicationId/stage — body { stage, comment, rejection_reason,
  // rejection_notes }. Valida el mapa de transiciones (helpers/candidateStages.js) y escribe el historial.
  changeStage: async (req, res) => {
    try {
      const application = await db.CandidateApplication.findOne({
        where: { id: req.params.applicationId, candidate_id: req.params.id },
      });
      if (!application) return res.status(404).json({ error: "Postulación no encontrada." });

      const { stage, comment, rejection_reason, rejection_notes } = req.body || {};
      if (!STAGES.includes(stage)) return res.status(400).json({ error: "Etapa inválida." });
      if (stage === "hired") {
        return res.status(400).json({ error: "La contratación se registra dando de alta al postulante como empleado." });
      }
      if (!canTransition(application.stage, stage)) {
        return res.status(400).json({ error: `No se puede pasar la postulación de "${application.stage}" a "${stage}".` });
      }
      if (stage === "rejected" && !REJECTION_REASONS.includes(rejection_reason)) {
        return res.status(400).json({ error: "Elegí el motivo del rechazo." });
      }

      const reopening = !isOpenStage(application.stage) && isOpenStage(stage);
      if (reopening) {
        const otherOpen = await db.CandidateApplication.count({
          where: { candidate_id: application.candidate_id, stage: { [Op.in]: OPEN_STAGES }, id: { [Op.ne]: application.id } },
        });
        if (otherOpen > 0) return res.status(400).json({ error: "Este postulante ya tiene otra postulación abierta." });
      }

      const previousStage = application.stage;
      const transaction = await db.sequelize.transaction();
      try {
        await application.update(
          {
            stage,
            // El motivo del rechazo solo tiene sentido mientras está rechazada: al reabrir o retirar se limpia.
            rejection_reason: stage === "rejected" ? rejection_reason : null,
            rejection_notes: stage === "rejected" ? blankToNull(rejection_notes) : null,
          },
          { transaction }
        );
        await writeLog(
          {
            applicationId: application.id,
            event: reopening ? "reopened" : "stage_changed",
            fromStage: previousStage,
            toStage: stage,
            comment: comment || (stage === "rejected" ? rejection_notes : null),
            changedBy: req.user.id,
          },
          transaction
        );
        await transaction.commit();
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
      return res.status(200).json({ data: await loadDetail(req.params.id) });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // GET /candidates/:id/history — historial de TODAS las postulaciones de la persona, más nuevo primero.
  history: async (req, res) => {
    try {
      const candidate = await db.Candidate.findByPk(req.params.id, { attributes: ["id"] });
      if (!candidate) return res.status(404).json({ error: "Postulante no encontrado." });

      const applications = await db.CandidateApplication.findAll({
        where: { candidate_id: candidate.id },
        attributes: ["id", "position_of_interest", "applied_at"],
      });
      const byId = new Map(applications.map((a) => [a.id, a]));
      const logs = applications.length === 0 ? [] : await db.CandidateApplicationLog.findAll({
        where: { application_id: applications.map((a) => a.id) },
        include: [{ model: db.User, as: "changedByUser", attributes: userAttrs }],
        order: [["changed_at", "DESC"], ["id", "DESC"]],
      });

      const data = logs.map((log) => ({
        id: log.id,
        application_id: log.application_id,
        position_of_interest: byId.get(log.application_id)?.position_of_interest || null,
        event: log.event,
        from_stage: log.from_stage,
        to_stage: log.to_stage,
        comment: log.comment,
        at: log.changed_at,
        actor: log.changedByUser ? { id: log.changedByUser.id, name: log.changedByUser.name, lastname: log.changedByUser.lastname } : null,
      }));
      return res.status(200).json({ data });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
