"use strict";
// Entrevistas de postulantes (ver FLOWS.md §61): agendar mueve la postulación a "interview", avisa a los
// entrevistadores, y el resultado se carga aparte sin mover de etapa. Rutas bajo /candidates/:id/interviews:
// candidates_write agenda, candidates_update edita y carga el resultado, candidates_read ve.
const db = require("../../models");
const { createActor, as } = require("../helpers/auth");

let dniCounter = 27000000;
const createCandidate = () => db.Candidate.create({ name: "Juan", lastname: "Pérez", dni: String((dniCounter += 1)), source: "in_person" });
const createApplication = (candidate, overrides = {}) =>
  db.CandidateApplication.create({ candidate_id: candidate.id, stage: "new", source: "in_person", applied_at: new Date(), ...overrides });

const FUTURE = () => new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
const WRITE = ["candidates_write"];
const UPDATE = ["candidates_update"];

async function waitFor(check, { tries = 40, delay = 25 } = {}) {
  for (let i = 0; i < tries; i += 1) {
    const value = await check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, delay));
  }
  return check();
}

async function schedule(actor, candidate, overrides = {}) {
  const interviewer = overrides.interviewer || (await createActor({ permissions: ["candidates_read"] }));
  const res = await as(actor).post(`/candidates/${candidate.id}/interviews`).send({
    scheduled_at: FUTURE(), duration_minutes: 45, modality: "in_person", location: "Oficina", interviewer_ids: [interviewer.user.id], ...overrides.body,
  });
  return { res, interviewer };
}

describe("POST /candidates/:id/interviews", () => {
  it("agenda la entrevista, mueve la postulación a 'interview' y escribe el historial", async () => {
    const actor = await createActor({ permissions: WRITE });
    const candidate = await createCandidate();
    const application = await createApplication(candidate, { stage: "screening" });

    const { res, interviewer } = await schedule(actor, candidate);

    expect(res.status).toBe(201);
    expect(res.body.data.interviewers.map((u) => u.id)).toEqual([interviewer.user.id]);
    const interview = await db.CandidateInterview.findOne();
    expect(interview).toMatchObject({ application_id: application.id, duration_minutes: 45, modality: "in_person", location: "Oficina", status: "scheduled", created_by: actor.user.id });
    expect((await db.CandidateApplication.findByPk(application.id)).stage).toBe("interview");
    const log = await db.CandidateApplicationLog.findOne({ where: { application_id: application.id } });
    expect(log).toMatchObject({ event: "interview_scheduled", from_stage: "screening", to_stage: "interview", changed_by: actor.user.id });
  });

  it("desde 'new' también pasa a 'interview'", async () => {
    const actor = await createActor({ permissions: WRITE });
    const candidate = await createCandidate();
    const application = await createApplication(candidate, { stage: "new" });
    await schedule(actor, candidate);
    expect((await db.CandidateApplication.findByPk(application.id)).stage).toBe("interview");
  });

  it("desde 'offer' agenda sin volver la postulación atrás", async () => {
    const actor = await createActor({ permissions: WRITE });
    const candidate = await createCandidate();
    const application = await createApplication(candidate, { stage: "offer" });

    const { res } = await schedule(actor, candidate);

    expect(res.status).toBe(201);
    expect((await db.CandidateApplication.findByPk(application.id)).stage).toBe("offer");
    const log = await db.CandidateApplicationLog.findOne({ where: { application_id: application.id } });
    expect(log.from_stage).toBeNull();
    expect(log.to_stage).toBeNull();
  });

  it("avisa a los entrevistadores y no a quien agenda", async () => {
    const actor = await createActor({ permissions: [...WRITE, "candidates_read"] });
    const candidate = await createCandidate();
    await createApplication(candidate);
    const other = await createActor({ permissions: ["candidates_read"] });
    const interviewer = await createActor({ permissions: ["candidates_read"] });

    await schedule(actor, candidate, { interviewer, body: { interviewer_ids: [interviewer.user.id, actor.user.id] } });

    await waitFor(async () => (await db.Notification.count()) >= 1);
    const forInterviewer = await db.Notification.findAll({ where: { user_id: interviewer.user.id } });
    expect(forInterviewer).toHaveLength(1);
    expect(forInterviewer[0]).toMatchObject({ type: "candidate_interview_assigned", title: "Entrevista asignada", url: `/dashboard/candidates/${candidate.id}` });
    expect(forInterviewer[0].body).toContain("Juan Pérez");
    expect(await db.Notification.count({ where: { user_id: actor.user.id } })).toBe(0);
    expect(await db.Notification.count({ where: { user_id: other.user.id } })).toBe(0);
  });

  it.each([
    ["sin fecha", { scheduled_at: "" }, /fecha y hora/],
    ["con una duración absurda", { duration_minutes: 9999 }, /duración/],
    ["con una modalidad desconocida", { modality: "telepatia" }, /modalidad/],
    ["sin entrevistadores", { interviewer_ids: [] }, /entrevistador/],
    ["con un entrevistador inexistente", { interviewer_ids: [999999] }, /no existe/],
  ])("rechaza con 400 %s y no cambia nada", async (_label, body, message) => {
    const actor = await createActor({ permissions: WRITE });
    const candidate = await createCandidate();
    const application = await createApplication(candidate);

    const { res } = await schedule(actor, candidate, { body });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
    expect(await db.CandidateInterview.count()).toBe(0);
    expect((await db.CandidateApplication.findByPk(application.id)).stage).toBe("new");
  });

  it("rechaza un entrevistador que no puede ver postulantes", async () => {
    const actor = await createActor({ permissions: WRITE });
    const candidate = await createCandidate();
    await createApplication(candidate);
    const noAccess = await createActor({ permissions: ["quote_requests_read"] });

    const { res } = await schedule(actor, candidate, { interviewer: noAccess });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/acceso a Postulantes/);
  });

  it("acepta como entrevistador a quien tiene admin_granted", async () => {
    const actor = await createActor({ permissions: WRITE });
    const candidate = await createCandidate();
    await createApplication(candidate);
    const admin = await createActor({ role: "admin" });

    const { res } = await schedule(actor, candidate, { interviewer: admin });

    expect(res.status).toBe(201);
  });

  it("rechaza con 400 si el postulante no tiene una postulación abierta", async () => {
    const actor = await createActor({ permissions: WRITE });
    const candidate = await createCandidate();
    await createApplication(candidate, { stage: "rejected", rejection_reason: "other" });

    const { res } = await schedule(actor, candidate);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/postulación abierta/);
    expect(await db.CandidateInterview.count()).toBe(0);
  });

  it("devuelve 404 si el postulante no existe, 401 sin el permiso y deja pasar a admin_granted", async () => {
    const actor = await createActor({ permissions: WRITE });
    const without = await createActor({ permissions: ["candidates_read", "candidates_update"] });
    const admin = await createActor({ role: "admin" });
    const candidate = await createCandidate();
    await createApplication(candidate);

    expect((await schedule(actor, { id: 999999 })).res.status).toBe(404);
    expect((await schedule(without, candidate)).res.status).toBe(401);
    expect((await schedule(admin, candidate)).res.status).toBe(201);
  });
});

describe("PUT /candidates/:id/interviews/:interviewId", () => {
  async function scheduled(candidate) {
    const writer = await createActor({ permissions: WRITE });
    await createApplication(candidate);
    const { res, interviewer } = await schedule(writer, candidate);
    return { id: res.body.data.id, interviewer };
  }

  it("reprograma, deja el historial y avisa a los entrevistadores que ya estaban", async () => {
    const actor = await createActor({ permissions: UPDATE });
    const candidate = await createCandidate();
    const { id, interviewer } = await scheduled(candidate);
    await waitFor(async () => (await db.Notification.count()) >= 1);
    await db.Notification.destroy({ where: {} });
    // Sin milisegundos: MySQL guarda el DATETIME a la precisión de segundos.
    const newDate = new Date(Math.floor((Date.now() + 5 * 24 * 60 * 60 * 1000) / 1000) * 1000).toISOString();

    const res = await as(actor).put(`/candidates/${candidate.id}/interviews/${id}`).send({ scheduled_at: newDate });

    expect(res.status).toBe(200);
    expect(new Date((await db.CandidateInterview.findByPk(id)).scheduled_at).toISOString()).toBe(newDate);
    expect(await db.CandidateApplicationLog.count({ where: { event: "interview_rescheduled" } })).toBe(1);
    await waitFor(async () => (await db.Notification.count()) >= 1);
    const notifs = await db.Notification.findAll({ where: { user_id: interviewer.user.id } });
    expect(notifs).toHaveLength(1);
    expect(notifs[0].title).toBe("Entrevista reprogramada");
  });

  it("cambiar entrevistadores avisa solo a los nuevos como asignación", async () => {
    const actor = await createActor({ permissions: UPDATE });
    const candidate = await createCandidate();
    const { id, interviewer } = await scheduled(candidate);
    await waitFor(async () => (await db.Notification.count()) >= 1);
    await db.Notification.destroy({ where: {} });
    const added = await createActor({ permissions: ["candidates_read"] });

    await as(actor).put(`/candidates/${candidate.id}/interviews/${id}`).send({ interviewer_ids: [interviewer.user.id, added.user.id] });

    await waitFor(async () => (await db.Notification.count()) >= 1);
    expect(await db.Notification.count({ where: { user_id: added.user.id, title: "Entrevista asignada" } })).toBe(1);
    expect(await db.Notification.count({ where: { user_id: interviewer.user.id } })).toBe(0);
  });

  it("cancelar y marcar 'no vino' dejan el historial y no avisan", async () => {
    const actor = await createActor({ permissions: UPDATE });
    const candidate = await createCandidate();
    const { id } = await scheduled(candidate);
    await waitFor(async () => (await db.Notification.count()) >= 1);
    await db.Notification.destroy({ where: {} });

    const res = await as(actor).put(`/candidates/${candidate.id}/interviews/${id}`).send({ status: "cancelled" });

    expect(res.status).toBe(200);
    expect((await db.CandidateInterview.findByPk(id)).status).toBe("cancelled");
    expect(await db.CandidateApplicationLog.count({ where: { event: "interview_cancelled" } })).toBe(1);
    await new Promise((r) => setTimeout(r, 150));
    expect(await db.Notification.count()).toBe(0);
  });

  it("no deja pasar a 'completed' ni volver a 'scheduled' por acá", async () => {
    const actor = await createActor({ permissions: UPDATE });
    const candidate = await createCandidate();
    const { id } = await scheduled(candidate);

    expect((await as(actor).put(`/candidates/${candidate.id}/interviews/${id}`).send({ status: "completed" })).status).toBe(400);
    expect((await as(actor).put(`/candidates/${candidate.id}/interviews/${id}`).send({ status: "scheduled" })).status).toBe(400);
  });

  it("no deja modificar una entrevista que ya no está agendada", async () => {
    const actor = await createActor({ permissions: UPDATE });
    const candidate = await createCandidate();
    const { id } = await scheduled(candidate);
    await db.CandidateInterview.update({ status: "completed" }, { where: { id } });

    const res = await as(actor).put(`/candidates/${candidate.id}/interviews/${id}`).send({ location: "Otra" });

    expect(res.status).toBe(400);
  });

  it("devuelve 404 si la entrevista es de otro postulante, 401 con solo _write y deja pasar a admin_granted", async () => {
    const actor = await createActor({ permissions: UPDATE });
    const writer = await createActor({ permissions: WRITE });
    const admin = await createActor({ role: "admin" });
    const candidate = await createCandidate();
    const other = await createCandidate();
    const { id } = await scheduled(candidate);

    expect((await as(actor).put(`/candidates/${other.id}/interviews/${id}`).send({ location: "x" })).status).toBe(404);
    expect((await as(writer).put(`/candidates/${candidate.id}/interviews/${id}`).send({ location: "x" })).status).toBe(401);
    expect((await as(admin).put(`/candidates/${candidate.id}/interviews/${id}`).send({ location: "x" })).status).toBe(200);
  });
});

describe("PUT /candidates/:id/interviews/:interviewId/result", () => {
  async function scheduled(candidate, stage = "new") {
    const writer = await createActor({ permissions: WRITE });
    const application = await createApplication(candidate, { stage });
    const { res } = await schedule(writer, candidate);
    return { id: res.body.data.id, application };
  }
  const body = { rating: 4, recommendation: "advance", feedback: "Buen manejo técnico" };

  it("carga el resultado, pasa la entrevista a realizada y NO mueve la postulación de etapa", async () => {
    const actor = await createActor({ permissions: UPDATE });
    const candidate = await createCandidate();
    const { id, application } = await scheduled(candidate);

    const res = await as(actor).put(`/candidates/${candidate.id}/interviews/${id}/result`).send(body);

    expect(res.status).toBe(200);
    expect(await db.CandidateInterview.findByPk(id)).toMatchObject({ status: "completed", rating: 4, recommendation: "advance", feedback: "Buen manejo técnico" });
    expect((await db.CandidateApplication.findByPk(application.id)).stage).toBe("interview");
    const log = await db.CandidateApplicationLog.findOne({ where: { event: "interview_result" } });
    expect(log.comment).toContain("4/5");
    expect(log.comment).toContain("Buen manejo técnico");
  });

  it("permite corregir un resultado ya cargado", async () => {
    const actor = await createActor({ permissions: UPDATE });
    const candidate = await createCandidate();
    const { id } = await scheduled(candidate);
    await as(actor).put(`/candidates/${candidate.id}/interviews/${id}/result`).send(body);

    const res = await as(actor).put(`/candidates/${candidate.id}/interviews/${id}/result`).send({ ...body, rating: 2, recommendation: "reject" });

    expect(res.status).toBe(200);
    expect(await db.CandidateInterview.findByPk(id)).toMatchObject({ rating: 2, recommendation: "reject" });
    expect((await db.CandidateApplicationLog.findAll({ where: { event: "interview_result" } })).pop().comment).toMatch(/corregido/);
  });

  it.each([
    ["un puntaje fuera de rango", { rating: 9 }],
    ["una recomendación inexistente", { recommendation: "quien-sabe" }],
  ])("rechaza con 400 %s", async (_label, patch) => {
    const actor = await createActor({ permissions: UPDATE });
    const candidate = await createCandidate();
    const { id } = await scheduled(candidate);

    const res = await as(actor).put(`/candidates/${candidate.id}/interviews/${id}/result`).send({ ...body, ...patch });

    expect(res.status).toBe(400);
    expect((await db.CandidateInterview.findByPk(id)).status).toBe("scheduled");
  });

  it("rechaza el resultado de una entrevista cancelada", async () => {
    const actor = await createActor({ permissions: UPDATE });
    const candidate = await createCandidate();
    const { id } = await scheduled(candidate);
    await db.CandidateInterview.update({ status: "cancelled" }, { where: { id } });

    const res = await as(actor).put(`/candidates/${candidate.id}/interviews/${id}/result`).send(body);

    expect(res.status).toBe(400);
  });

  it("devuelve 401 sin el permiso exacto y deja pasar a admin_granted", async () => {
    const writer = await createActor({ permissions: WRITE });
    const admin = await createActor({ role: "admin" });
    const candidate = await createCandidate();
    const { id } = await scheduled(candidate);

    expect((await as(writer).put(`/candidates/${candidate.id}/interviews/${id}/result`).send(body)).status).toBe(401);
    expect((await as(admin).put(`/candidates/${candidate.id}/interviews/${id}/result`).send(body)).status).toBe(200);
  });
});

describe("GET /candidates/:id (entrevistas en el detalle)", () => {
  it("incluye las entrevistas con sus entrevistadores, la más próxima primero", async () => {
    const reader = await createActor({ permissions: ["candidates_read"] });
    const writer = await createActor({ permissions: WRITE });
    const candidate = await createCandidate();
    await createApplication(candidate);
    const { res: first } = await schedule(writer, candidate, { body: { scheduled_at: new Date(Date.now() + 2 * 86400000).toISOString() } });
    const { res: second } = await schedule(writer, candidate, { body: { scheduled_at: new Date(Date.now() + 9 * 86400000).toISOString() } });

    const res = await as(reader).get(`/candidates/${candidate.id}`);

    expect(res.body.data.interviews.map((i) => i.id)).toEqual([second.body.data.id, first.body.data.id]);
    expect(res.body.data.interviews[0].interviewers).toHaveLength(1);
  });
});

describe("GET /candidates/interviews/upcoming", () => {
  const todayAt = (hour) => {
    const d = new Date();
    return new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(d)}T${String(hour).padStart(2, "0")}:00:00-03:00`);
  };

  it("devuelve las entrevistas de hoy y mañana donde el usuario es entrevistador, con el postulante", async () => {
    const interviewer = await createActor({ permissions: ["candidates_read"] });
    const candidate = await createCandidate();
    const application = await createApplication(candidate, { stage: "interview" });
    const make = (when, status = "scheduled") => db.CandidateInterview.create({ application_id: application.id, scheduled_at: when, status });
    const today = await make(todayAt(23));
    const tomorrow = await make(new Date(todayAt(10).getTime() + 86400000));
    const later = await make(new Date(todayAt(10).getTime() + 3 * 86400000));
    const cancelled = await make(todayAt(15), "cancelled");
    for (const i of [today, tomorrow, later, cancelled]) await i.setInterviewers([interviewer.user.id]);
    const notMine = await make(todayAt(12));
    await notMine.setInterviewers([(await createActor({ permissions: ["candidates_read"] })).user.id]);

    const res = await as(interviewer).get("/candidates/interviews/upcoming");

    expect(res.status).toBe(200);
    expect(res.body.data.map((i) => i.id)).toEqual([today.id, tomorrow.id]);
    expect(res.body.data[0].application.candidate).toMatchObject({ id: candidate.id, name: "Juan" });
  });

  it("incluye las de hoy que ya pasaron y siguen sin resultado", async () => {
    const interviewer = await createActor({ permissions: ["candidates_read"] });
    const candidate = await createCandidate();
    const application = await createApplication(candidate, { stage: "interview" });
    const past = await db.CandidateInterview.create({ application_id: application.id, scheduled_at: todayAt(0), status: "scheduled" });
    await past.setInterviewers([interviewer.user.id]);

    const res = await as(interviewer).get("/candidates/interviews/upcoming");

    expect(res.body.data.map((i) => i.id)).toEqual([past.id]);
  });

  it("devuelve 401 sin el permiso y deja pasar a admin_granted", async () => {
    const without = await createActor();
    const admin = await createActor({ role: "admin" });
    expect((await as(without).get("/candidates/interviews/upcoming")).status).toBe(401);
    expect((await as(admin).get("/candidates/interviews/upcoming")).status).toBe(200);
  });
});

describe("GET /lookup/interviewers", () => {
  it("lista solo a quienes pueden ver postulantes, sin exigir users_read", async () => {
    const actor = await createActor();
    const reader = await createActor({ permissions: ["candidates_read"] });
    const admin = await createActor({ role: "admin" });
    await createActor({ permissions: ["quote_requests_read"] });

    const res = await as(actor).get("/lookup/interviewers");

    expect(res.status).toBe(200);
    const ids = res.body.data.map((u) => u.id);
    expect(ids).toEqual(expect.arrayContaining([reader.user.id, admin.user.id]));
    expect(ids).toHaveLength(2);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(["id", "lastname", "name"]);
  });
});
