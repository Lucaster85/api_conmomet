"use strict";
// Postulaciones de un postulante (ver FLOWS.md §59): crear una nueva, cambiar de etapa con el mapa de
// transiciones, reabrir, y el historial. changeStage y createApplication son PUT/POST sobre
// /candidates/:id/..., así que los resuelven candidates_update y candidates_write.
const db = require("../../models");
const { createActor, as } = require("../helpers/auth");

let dniCounter = 25000000;
async function createCandidate(overrides = {}) {
  return db.Candidate.create({ name: "Juan", lastname: "Pérez", dni: String((dniCounter += 1)), source: "in_person", ...overrides });
}
async function createApplication(candidate, overrides = {}) {
  return db.CandidateApplication.create({ candidate_id: candidate.id, stage: "new", source: "in_person", applied_at: new Date(), ...overrides });
}

const stageUrl = (candidate, application) => `/candidates/${candidate.id}/applications/${application.id}/stage`;
const UPDATE = ["candidates_update"];

describe("PUT /candidates/:id/applications/:applicationId/stage", () => {
  it("mueve la postulación y escribe el historial con quién, de dónde, a dónde y el comentario", async () => {
    const actor = await createActor({ permissions: UPDATE });
    const candidate = await createCandidate();
    const application = await createApplication(candidate);

    const res = await as(actor).put(stageUrl(candidate, application)).send({ stage: "screening", comment: "Llamarlo el lunes" });

    expect(res.status).toBe(200);
    expect((await db.CandidateApplication.findByPk(application.id)).stage).toBe("screening");
    const logs = await db.CandidateApplicationLog.findAll({ where: { application_id: application.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ event: "stage_changed", from_stage: "new", to_stage: "screening", comment: "Llamarlo el lunes", changed_by: actor.user.id });
  });

  it("recorre el camino completo new → screening → interview → offer", async () => {
    const actor = await createActor({ permissions: UPDATE });
    const candidate = await createCandidate();
    const application = await createApplication(candidate);

    for (const stage of ["screening", "interview", "offer"]) {
      const res = await as(actor).put(stageUrl(candidate, application)).send({ stage });
      expect(res.status).toBe(200);
    }

    expect((await db.CandidateApplication.findByPk(application.id)).stage).toBe("offer");
  });

  it("rechaza con 400 una transición que el mapa no permite y no cambia nada", async () => {
    const actor = await createActor({ permissions: UPDATE });
    const candidate = await createCandidate();
    const application = await createApplication(candidate, { stage: "new" });

    const res = await as(actor).put(stageUrl(candidate, application)).send({ stage: "offer" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No se puede pasar/);
    expect((await db.CandidateApplication.findByPk(application.id)).stage).toBe("new");
    expect(await db.CandidateApplicationLog.count()).toBe(0);
  });

  it("no deja pasar a 'hired' a mano: se alcanza dando de alta como empleado", async () => {
    const actor = await createActor({ permissions: UPDATE });
    const candidate = await createCandidate();
    const application = await createApplication(candidate, { stage: "offer" });

    const res = await as(actor).put(stageUrl(candidate, application)).send({ stage: "hired" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/empleado/);
    expect((await db.CandidateApplication.findByPk(application.id)).stage).toBe("offer");
  });

  it("rechaza con 400 una etapa inexistente", async () => {
    const actor = await createActor({ permissions: UPDATE });
    const candidate = await createCandidate();
    const application = await createApplication(candidate);
    const res = await as(actor).put(stageUrl(candidate, application)).send({ stage: "volando" });
    expect(res.status).toBe(400);
  });

  it("rechazar exige un motivo y lo guarda junto con las notas", async () => {
    const actor = await createActor({ permissions: UPDATE });
    const candidate = await createCandidate();
    const application = await createApplication(candidate);

    const missing = await as(actor).put(stageUrl(candidate, application)).send({ stage: "rejected" });
    const invalid = await as(actor).put(stageUrl(candidate, application)).send({ stage: "rejected", rejection_reason: "no-me-gusta" });
    const ok = await as(actor).put(stageUrl(candidate, application)).send({ stage: "rejected", rejection_reason: "profile_mismatch", rejection_notes: "Busca otro oficio" });

    expect(missing.status).toBe(400);
    expect(invalid.status).toBe(400);
    expect(ok.status).toBe(200);
    const row = await db.CandidateApplication.findByPk(application.id);
    expect(row).toMatchObject({ stage: "rejected", rejection_reason: "profile_mismatch", rejection_notes: "Busca otro oficio" });
    // Las notas del rechazo quedan también en el historial si no se mandó un comentario aparte.
    const log = await db.CandidateApplicationLog.findOne({ where: { application_id: application.id } });
    expect(log.comment).toBe("Busca otro oficio");
  });

  it("reabrir una rechazada la vuelve a 'screening', limpia el motivo y lo registra como 'reopened'", async () => {
    const actor = await createActor({ permissions: UPDATE });
    const candidate = await createCandidate();
    const application = await createApplication(candidate, { stage: "rejected", rejection_reason: "no_response", rejection_notes: "No contestó" });

    const res = await as(actor).put(stageUrl(candidate, application)).send({ stage: "screening" });

    expect(res.status).toBe(200);
    const row = await db.CandidateApplication.findByPk(application.id);
    expect(row).toMatchObject({ stage: "screening", rejection_reason: null, rejection_notes: null });
    const log = await db.CandidateApplicationLog.findOne({ where: { application_id: application.id } });
    expect(log).toMatchObject({ event: "reopened", from_stage: "rejected", to_stage: "screening" });
  });

  it("retirar limpia un motivo de rechazo que hubiera quedado", async () => {
    const actor = await createActor({ permissions: UPDATE });
    const candidate = await createCandidate();
    const application = await createApplication(candidate, { stage: "new" });

    await as(actor).put(stageUrl(candidate, application)).send({ stage: "withdrawn", rejection_reason: "other" });

    expect((await db.CandidateApplication.findByPk(application.id)).rejection_reason).toBeNull();
  });

  it("no deja reabrir si el postulante ya tiene otra postulación abierta", async () => {
    const actor = await createActor({ permissions: UPDATE });
    const candidate = await createCandidate();
    const closed = await createApplication(candidate, { stage: "rejected", rejection_reason: "other" });
    await createApplication(candidate, { stage: "interview" });

    const res = await as(actor).put(stageUrl(candidate, closed)).send({ stage: "screening" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/otra postulación abierta/);
    expect((await db.CandidateApplication.findByPk(closed.id)).stage).toBe("rejected");
  });

  it("una contratada ('hired') no se puede mover", async () => {
    const actor = await createActor({ permissions: UPDATE });
    const candidate = await createCandidate();
    const application = await createApplication(candidate, { stage: "hired" });

    const res = await as(actor).put(stageUrl(candidate, application)).send({ stage: "screening" });

    expect(res.status).toBe(400);
  });

  it("devuelve 404 si la postulación es de otro postulante", async () => {
    const actor = await createActor({ permissions: UPDATE });
    const candidate = await createCandidate();
    const other = await createCandidate();
    const foreign = await createApplication(other);

    const res = await as(actor).put(stageUrl(candidate, foreign)).send({ stage: "screening" });

    expect(res.status).toBe(404);
  });

  it("devuelve 401 sin el permiso exacto y deja pasar a admin_granted", async () => {
    const readOnly = await createActor({ permissions: ["candidates_read", "candidates_write"] });
    const admin = await createActor({ role: "admin" });
    const candidate = await createCandidate();
    const application = await createApplication(candidate);

    expect((await as(readOnly).put(stageUrl(candidate, application)).send({ stage: "screening" })).status).toBe(401);
    expect((await as(admin).put(stageUrl(candidate, application)).send({ stage: "screening" })).status).toBe(200);
  });
});

describe("POST /candidates/:id/applications", () => {
  const WRITE = ["candidates_write"];

  it("crea una postulación nueva cuando las anteriores están cerradas, con su historial", async () => {
    const actor = await createActor({ permissions: WRITE });
    const candidate = await createCandidate({ trade: "Pintor" });
    await createApplication(candidate, { stage: "rejected", rejection_reason: "other" });

    const res = await as(actor).post(`/candidates/${candidate.id}/applications`).send({ position_of_interest: "Pintor industrial", cover_letter: "Vuelvo a intentarlo" });

    expect(res.status).toBe(201);
    const applications = await db.CandidateApplication.findAll({ where: { candidate_id: candidate.id }, order: [["id", "ASC"]] });
    expect(applications).toHaveLength(2);
    expect(applications[1]).toMatchObject({ stage: "new", position_of_interest: "Pintor industrial", cover_letter: "Vuelvo a intentarlo", created_by: actor.user.id });
    expect(await db.CandidateApplicationLog.count({ where: { application_id: applications[1].id, event: "created" } })).toBe(1);
  });

  it("rechaza con 400 si ya tiene una postulación abierta", async () => {
    const actor = await createActor({ permissions: WRITE });
    const candidate = await createCandidate();
    await createApplication(candidate, { stage: "screening" });

    const res = await as(actor).post(`/candidates/${candidate.id}/applications`).send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/postulación abierta/);
    expect(await db.CandidateApplication.count()).toBe(1);
  });

  it("rechaza con 400 si el postulante ya fue dado de alta como empleado", async () => {
    const actor = await createActor({ permissions: WRITE });
    const employee = await db.Employee.create({ name: "L", lastname: "G", dni: "31000111", cuil: "20310001119", hire_date: "2026-01-01", hourly_rate: 1000 });
    const candidate = await createCandidate({ employee_id: employee.id });

    const res = await as(actor).post(`/candidates/${candidate.id}/applications`).send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/empleado/);
  });

  it("devuelve 404 si el postulante no existe, 401 sin permiso y deja pasar a admin_granted", async () => {
    const actor = await createActor({ permissions: WRITE });
    const without = await createActor({ permissions: ["candidates_read"] });
    const admin = await createActor({ role: "admin" });
    const candidate = await createCandidate();

    expect((await as(actor).post("/candidates/999999/applications").send({})).status).toBe(404);
    expect((await as(without).post(`/candidates/${candidate.id}/applications`).send({})).status).toBe(401);
    expect((await as(admin).post(`/candidates/${candidate.id}/applications`).send({})).status).toBe(201);
  });
});

describe("GET /candidates/:id/history", () => {
  const READ = ["candidates_read"];

  it("junta el historial de todas las postulaciones, el más nuevo primero, con quién hizo cada cambio", async () => {
    const actor = await createActor({ permissions: [...READ, ...UPDATE, "candidates_write"] });
    const candidate = await createCandidate();
    const first = await createApplication(candidate, { position_of_interest: "Pintor" });
    await db.CandidateApplicationLog.create({ application_id: first.id, event: "created", to_stage: "new", changed_at: new Date("2026-11-01T10:00:00Z") });
    await as(actor).put(stageUrl(candidate, first)).send({ stage: "screening", comment: "Lo llamé" });

    const res = await as(actor).get(`/candidates/${candidate.id}/history`);

    expect(res.status).toBe(200);
    expect(res.body.data.map((e) => e.event)).toEqual(["stage_changed", "created"]);
    expect(res.body.data[0]).toMatchObject({ from_stage: "new", to_stage: "screening", comment: "Lo llamé", position_of_interest: "Pintor" });
    expect(res.body.data[0].actor).toMatchObject({ id: actor.user.id });
    expect(res.body.data[1].actor).toBeNull();
    // La fecha tiene que ser parseable (los timestamps automáticos salen en camelCase: ver FLOWS.md §37).
    expect(Number.isNaN(new Date(res.body.data[0].at).getTime())).toBe(false);
  });

  it("devuelve una lista vacía si no hay postulaciones", async () => {
    const actor = await createActor({ permissions: READ });
    const candidate = await createCandidate();
    const res = await as(actor).get(`/candidates/${candidate.id}/history`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("devuelve 404 si no existe y 401 sin el permiso", async () => {
    const actor = await createActor({ permissions: READ });
    const without = await createActor();
    const candidate = await createCandidate();

    expect((await as(actor).get("/candidates/999999/history")).status).toBe(404);
    expect((await as(without).get(`/candidates/${candidate.id}/history`)).status).toBe(401);
  });
});
