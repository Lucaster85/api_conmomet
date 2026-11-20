const { sendServerError } = require("../helpers/httpErrors");
const { Op } = require("sequelize");
const db = require("../models");
const { notify, userHasPermission } = require("../helpers");
const { todayInArgentina, ARGENTINA_TZ } = require("../helpers/argentinaDate");
const { writeLog } = require("../helpers/candidateData");
const {
  STATUSES,
  SCHEDULABLE_STAGES,
  STAGES_THAT_MOVE_TO_INTERVIEW,
  parseScheduleBody,
  parseResultBody,
} = require("../helpers/candidateInterviews");

/**
 * Entrevistas de una postulación (ver FLOWS.md §61). Rutas bajo /candidates/:id/interviews, así que las
 * resuelve authPermission con candidates_write (agendar) y candidates_update (editar, cargar el
 * resultado). Agendar mueve la postulación a "interview", escribe el historial y avisa a los
 * entrevistadores con notify().
 */

const userAttrs = ["id", "name", "lastname"];
const interviewInclude = [{ model: db.User, as: "interviewers", attributes: userAttrs, through: { attributes: [] } }];

const formatWhen = (date) =>
  new Date(date).toLocaleString("es-AR", { timeZone: ARGENTINA_TZ, dateStyle: "short", timeStyle: "short" });

async function loadInterview(id) {
  return db.CandidateInterview.findByPk(id, { include: interviewInclude });
}

// Los entrevistadores tienen que existir y poder ver postulantes (candidates_read o admin_granted):
// si no, les llegaría un aviso a una ficha que no pueden abrir.
async function validateInterviewers(rawIds) {
  const ids = [...new Set((Array.isArray(rawIds) ? rawIds : []).map(Number))].filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) return { error: "Elegí al menos un entrevistador." };
  const users = await db.User.findAll({
    where: { id: ids },
    include: [
      { model: db.Role, as: "role", include: [{ model: db.Permission, as: "permissions" }] },
      { model: db.Permission, as: "permissions" },
    ],
  });
  if (users.length !== ids.length) return { error: "Algún entrevistador elegido no existe." };
  if (!users.every((u) => userHasPermission(u, "candidates_read"))) {
    return { error: "Algún entrevistador elegido no tiene acceso a Postulantes." };
  }
  return { ids };
}

// Busca la entrevista dentro del postulante de la URL: un id de otro postulante da 404, no se toca.
async function findInterviewOf(candidateId, interviewId) {
  const interview = await db.CandidateInterview.findByPk(interviewId, {
    include: [{ model: db.CandidateApplication, as: "application", attributes: ["id", "candidate_id", "stage"] }],
  });
  if (!interview || interview.application.candidate_id !== Number(candidateId)) return null;
  return interview;
}

const candidateName = async (candidateId) => {
  const c = await db.Candidate.findByPk(candidateId, { attributes: ["name", "lastname"] });
  return c ? `${c.name} ${c.lastname}` : "el postulante";
};

module.exports = {
  // POST /candidates/:id/interviews — body { application_id?, scheduled_at, duration_minutes, modality,
  // location, interviewer_ids }. Sin application_id usa la postulación abierta.
  create: async (req, res) => {
    try {
      const candidate = await db.Candidate.findByPk(req.params.id, { attributes: ["id", "name", "lastname"] });
      if (!candidate) return res.status(404).json({ error: "Postulante no encontrado." });

      const body = req.body || {};
      const where = { candidate_id: candidate.id, stage: SCHEDULABLE_STAGES };
      if (body.application_id) where.id = Number(body.application_id);
      const application = await db.CandidateApplication.findOne({ where, order: [["id", "DESC"]] });
      if (!application) return res.status(400).json({ error: "El postulante no tiene una postulación abierta para entrevistar." });

      const parsed = parseScheduleBody(body);
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      const interviewers = await validateInterviewers(body.interviewer_ids);
      if (interviewers.error) return res.status(400).json({ error: interviewers.error });

      const moves = STAGES_THAT_MOVE_TO_INTERVIEW.includes(application.stage);
      const previousStage = application.stage;
      const transaction = await db.sequelize.transaction();
      let interview;
      try {
        interview = await db.CandidateInterview.create({ ...parsed.data, application_id: application.id, created_by: req.user.id }, { transaction });
        await interview.setInterviewers(interviewers.ids, { transaction });
        if (moves) await application.update({ stage: "interview" }, { transaction });
        await writeLog(
          {
            applicationId: application.id,
            event: "interview_scheduled",
            fromStage: moves ? previousStage : null,
            toStage: moves ? "interview" : null,
            comment: `Entrevista agendada para el ${formatWhen(parsed.data.scheduled_at)}.`,
            changedBy: req.user.id,
          },
          transaction
        );
        await transaction.commit();
      } catch (error) {
        await transaction.rollback();
        throw error;
      }

      // Fire-and-forget: el aviso no puede romper una entrevista que ya se agendó.
      notify(interviewers.ids, {
        type: "candidate_interview_assigned",
        title: "Entrevista asignada",
        body: `${candidate.name} ${candidate.lastname} — ${formatWhen(parsed.data.scheduled_at)}`,
        url: `/dashboard/candidates/${candidate.id}`,
        tag: `candidate-interview-${interview.id}`,
        entity: { type: "candidate_interview", id: interview.id },
        excludeUserId: req.user.id,
      });

      return res.status(201).json({ data: await loadInterview(interview.id) });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  // PUT /candidates/:id/interviews/:interviewId — reprogramar o cambiar entrevistadores mientras está
  // agendada, o cancelarla / marcar que no vino (`status`). Una entrevista ya realizada no se edita
  // acá: su resultado va por /result.
  update: async (req, res) => {
    try {
      const interview = await findInterviewOf(req.params.id, req.params.interviewId);
      if (!interview) return res.status(404).json({ error: "Entrevista no encontrada." });
      if (interview.status !== "scheduled") {
        return res.status(400).json({ error: "Solo se puede modificar una entrevista que sigue agendada." });
      }

      const body = req.body || {};
      const parsed = parseScheduleBody(body, { partial: true });
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      const patch = { ...parsed.data };

      if (body.status !== undefined) {
        if (!STATUSES.includes(body.status) || ["scheduled", "completed"].includes(body.status)) {
          return res.status(400).json({ error: "Una entrevista agendada solo puede cancelarse o marcarse como ausente. El resultado se carga aparte." });
        }
        patch.status = body.status;
      }

      let interviewerIds = null;
      let added = [];
      let kept = [];
      if (body.interviewer_ids !== undefined) {
        const result = await validateInterviewers(body.interviewer_ids);
        if (result.error) return res.status(400).json({ error: result.error });
        interviewerIds = result.ids;
        const current = (await interview.getInterviewers({ attributes: ["id"] })).map((u) => u.id);
        added = interviewerIds.filter((id) => !current.includes(id));
        kept = interviewerIds.filter((id) => current.includes(id));
      }

      const rescheduled = patch.scheduled_at && patch.scheduled_at.getTime() !== new Date(interview.scheduled_at).getTime();
      const transaction = await db.sequelize.transaction();
      try {
        if (Object.keys(patch).length > 0) await interview.update(patch, { transaction });
        if (interviewerIds) await interview.setInterviewers(interviewerIds, { transaction });
        if (patch.status || rescheduled) {
          await writeLog(
            {
              applicationId: interview.application_id,
              event: patch.status ? "interview_cancelled" : "interview_rescheduled",
              comment: patch.status
                ? patch.status === "no_show" ? "El postulante no se presentó a la entrevista." : "Entrevista cancelada."
                : `Entrevista reprogramada para el ${formatWhen(patch.scheduled_at)}.`,
              changedBy: req.user.id,
            },
            transaction
          );
        }
        await transaction.commit();
      } catch (error) {
        await transaction.rollback();
        throw error;
      }

      const name = await candidateName(req.params.id);
      const common = { url: `/dashboard/candidates/${req.params.id}`, tag: `candidate-interview-${interview.id}`, entity: { type: "candidate_interview", id: interview.id }, excludeUserId: req.user.id };
      // A los nuevos, como una asignación; a los que ya estaban, solo si cambió la hora.
      if (added.length > 0 && !patch.status) {
        notify(added, { ...common, type: "candidate_interview_assigned", title: "Entrevista asignada", body: `${name} — ${formatWhen(patch.scheduled_at || interview.scheduled_at)}` });
      }
      if (rescheduled && !patch.status) {
        const targets = interviewerIds ? kept : (await interview.getInterviewers({ attributes: ["id"] })).map((u) => u.id);
        notify(targets, { ...common, type: "candidate_interview_assigned", title: "Entrevista reprogramada", body: `${name} — ${formatWhen(patch.scheduled_at)}` });
      }

      return res.status(200).json({ data: await loadInterview(interview.id) });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  // PUT /candidates/:id/interviews/:interviewId/result — body { rating 1-5, recommendation, feedback }.
  // Pasa la entrevista a "realizada". NO mueve la postulación de etapa: pasar a oferta o rechazar sigue
  // siendo una decisión que se toma a propósito desde la ficha. Se puede volver a cargar para corregirlo.
  result: async (req, res) => {
    try {
      const interview = await findInterviewOf(req.params.id, req.params.interviewId);
      if (!interview) return res.status(404).json({ error: "Entrevista no encontrada." });
      if (!["scheduled", "completed"].includes(interview.status)) {
        return res.status(400).json({ error: "No se puede cargar el resultado de una entrevista cancelada o a la que el postulante no vino." });
      }

      const parsed = parseResultBody(req.body || {});
      if (parsed.error) return res.status(400).json({ error: parsed.error });

      const firstTime = interview.status === "scheduled";
      const transaction = await db.sequelize.transaction();
      try {
        await interview.update({ ...parsed.data, status: "completed" }, { transaction });
        await writeLog(
          {
            applicationId: interview.application_id,
            event: "interview_result",
            comment: `${firstTime ? "Resultado" : "Resultado corregido"}: ${parsed.data.rating}/5, recomienda ${{ advance: "avanzar", hold: "esperar", reject: "no avanzar" }[parsed.data.recommendation]}.${parsed.data.feedback ? ` ${parsed.data.feedback}` : ""}`,
            changedBy: req.user.id,
          },
          transaction
        );
        await transaction.commit();
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
      return res.status(200).json({ data: await loadInterview(interview.id) });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  // GET /candidates/interviews/upcoming — las entrevistas agendadas de HOY y MAÑANA donde el usuario
  // logueado es entrevistador (alimenta el aviso del tablero). Incluye las de hoy que ya pasaron y siguen
  // sin resultado: son justamente las que hay que cerrar. "Hoy" es el de Argentina, no el del servidor (UTC).
  upcoming: async (req, res) => {
    try {
      const start = new Date(`${todayInArgentina()}T00:00:00-03:00`);
      const end = new Date(start.getTime() + 2 * 24 * 60 * 60 * 1000);
      const interviews = await db.CandidateInterview.findAll({
        where: { status: "scheduled", scheduled_at: { [Op.gte]: start, [Op.lt]: end } },
        include: [
          { model: db.User, as: "interviewers", where: { id: req.user.id }, required: true, attributes: [], through: { attributes: [] } },
          {
            model: db.CandidateApplication,
            as: "application",
            attributes: ["id", "position_of_interest"],
            include: [{ model: db.Candidate, as: "candidate", attributes: ["id", "name", "lastname", "phone"] }],
          },
        ],
        order: [["scheduled_at", "ASC"]],
      });
      return res.status(200).json({ data: interviews });
    } catch (error) {
      return sendServerError(res, error);
    }
  },
};
