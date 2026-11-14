"use strict";
// Conversión de un postulante en empleado (ver FLOWS.md §62): POST /employees con `candidate_id`. Exige
// employees_write (authPermission) Y candidates_update (controller), y todo ocurre en una transacción.
const db = require("../../models");
const { createActor, as } = require("../helpers/auth");

let dniCounter = 28000000;
const nextDni = () => String((dniCounter += 1));

async function createCandidate(overrides = {}) {
  return db.Candidate.create({ name: "María", lastname: "López", dni: nextDni(), cuil: "20301234563", source: "in_person", ...overrides });
}
const createApplication = (candidate, overrides = {}) =>
  db.CandidateApplication.create({ candidate_id: candidate.id, stage: "interview", source: "in_person", applied_at: new Date(), ...overrides });

const BOTH = ["employees_write", "candidates_update"];

// El alta como la manda el formulario de empleados, con los datos del postulante precargados.
const employeeBody = (candidate, overrides = {}) => ({
  name: candidate.name, lastname: candidate.lastname, dni: candidate.dni, cuil: candidate.cuil,
  hire_date: "2026-12-01", hourly_rate: 1500, pay_type: "hourly", candidate_id: candidate.id, ...overrides,
});

describe("POST /employees con candidate_id", () => {
  it("crea el empleado, vincula al postulante, pasa su postulación a 'hired' y deja el historial", async () => {
    const actor = await createActor({ permissions: BOTH });
    const candidate = await createCandidate();
    const application = await createApplication(candidate);

    const res = await as(actor).post("/employees").send(employeeBody(candidate));

    expect(res.status).toBe(201);
    const employee = await db.Employee.findOne({ where: { dni: candidate.dni } });
    expect(employee).toMatchObject({ name: "María", hire_date: "2026-12-01" });
    const row = await db.Candidate.findByPk(candidate.id);
    expect(row).toMatchObject({ employee_id: employee.id, converted_by: actor.user.id });
    expect(row.converted_at).not.toBeNull();
    expect((await db.CandidateApplication.findByPk(application.id)).stage).toBe("hired");
    const log = await db.CandidateApplicationLog.findOne({ where: { application_id: application.id, event: "converted" } });
    expect(log).toMatchObject({ from_stage: "interview", to_stage: "hired", changed_by: actor.user.id });
  });

  it("también se puede desde 'offer'", async () => {
    const actor = await createActor({ permissions: BOTH });
    const candidate = await createCandidate();
    const application = await createApplication(candidate, { stage: "offer" });

    const res = await as(actor).post("/employees").send(employeeBody(candidate));

    expect(res.status).toBe(201);
    expect((await db.CandidateApplication.findByPk(application.id)).stage).toBe("hired");
  });

  it.each(["new", "screening"])("rechaza con 400 si la postulación está en '%s' y no crea nada", async (stage) => {
    const actor = await createActor({ permissions: BOTH });
    const candidate = await createCandidate();
    await createApplication(candidate, { stage });

    const res = await as(actor).post("/employees").send(employeeBody(candidate));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/entrevista o en oferta/);
    expect(await db.Employee.count()).toBe(0);
    expect((await db.Candidate.findByPk(candidate.id)).employee_id).toBeNull();
  });

  it("rechaza con 400 si no tiene ninguna postulación abierta", async () => {
    const actor = await createActor({ permissions: BOTH });
    const candidate = await createCandidate();
    await createApplication(candidate, { stage: "rejected", rejection_reason: "other" });

    const res = await as(actor).post("/employees").send(employeeBody(candidate));

    expect(res.status).toBe(400);
    expect(await db.Employee.count()).toBe(0);
  });

  it("cierra las demás postulaciones abiertas como retiradas y cancela las entrevistas agendadas", async () => {
    const actor = await createActor({ permissions: BOTH });
    const candidate = await createCandidate();
    const hiring = await createApplication(candidate, { stage: "offer" });
    const other = await createApplication(candidate, { stage: "screening" });
    const closed = await createApplication(candidate, { stage: "rejected", rejection_reason: "other" });
    const scheduled = await db.CandidateInterview.create({ application_id: hiring.id, scheduled_at: new Date(Date.now() + 86400000), status: "scheduled" });
    const done = await db.CandidateInterview.create({ application_id: hiring.id, scheduled_at: new Date(Date.now() - 86400000), status: "completed", rating: 5, recommendation: "advance" });

    const res = await as(actor).post("/employees").send(employeeBody(candidate));

    expect(res.status).toBe(201);
    expect((await db.CandidateApplication.findByPk(other.id)).stage).toBe("withdrawn");
    expect((await db.CandidateApplication.findByPk(closed.id)).stage).toBe("rejected");
    expect(await db.CandidateApplicationLog.count({ where: { application_id: other.id, to_stage: "withdrawn" } })).toBe(1);
    expect((await db.CandidateInterview.findByPk(scheduled.id)).status).toBe("cancelled");
    expect((await db.CandidateInterview.findByPk(done.id)).status).toBe("completed");
  });

  it("exige también candidates_update: con solo employees_write responde 403 y no crea nada", async () => {
    const actor = await createActor({ permissions: ["employees_write"] });
    const candidate = await createCandidate();
    await createApplication(candidate);

    const res = await as(actor).post("/employees").send(employeeBody(candidate));

    expect(res.status).toBe(403);
    expect(await db.Employee.count()).toBe(0);
    expect((await db.Candidate.findByPk(candidate.id)).employee_id).toBeNull();
  });

  it("sin employees_write responde 401 aunque tenga candidates_update, y deja pasar a admin_granted", async () => {
    const noEmployees = await createActor({ permissions: ["candidates_update"] });
    const admin = await createActor({ role: "admin" });
    const candidate = await createCandidate();
    await createApplication(candidate);

    expect((await as(noEmployees).post("/employees").send(employeeBody(candidate))).status).toBe(401);
    expect((await as(admin).post("/employees").send(employeeBody(candidate))).status).toBe(201);
  });

  it("devuelve 404 si el postulante no existe", async () => {
    const actor = await createActor({ permissions: BOTH });
    const candidate = await createCandidate();
    const res = await as(actor).post("/employees").send(employeeBody(candidate, { candidate_id: 999999 }));
    expect(res.status).toBe(404);
    expect(await db.Employee.count()).toBe(0);
  });

  it("rechaza con 400 si el postulante ya fue convertido", async () => {
    const actor = await createActor({ permissions: BOTH });
    const candidate = await createCandidate();
    await createApplication(candidate);
    expect((await as(actor).post("/employees").send(employeeBody(candidate))).status).toBe(201);

    const again = await as(actor).post("/employees").send(employeeBody(candidate, { dni: nextDni(), cuil: "20301234563" }));

    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/ya fue dado de alta/);
    expect(await db.Employee.count()).toBe(1);
  });

  it.each([
    ["con baja lógica", async (e) => e.destroy()],
    ["inactivo con fecha de egreso", async (e) => e.update({ status: "inactive", termination_date: "2025-06-30" })],
  ])("bloquea la conversión de un ex-empleado (%s) y no toca nada", async (_label, retire) => {
    const actor = await createActor({ permissions: BOTH });
    const former = await db.Employee.create({ name: "L", lastname: "G", dni: nextDni(), cuil: "20311111118", hire_date: "2024-01-01", hourly_rate: 1000 });
    await retire(former);
    const candidate = await createCandidate({ dni: former.dni });
    const application = await createApplication(candidate);

    const res = await as(actor).post("/employees").send(employeeBody(candidate, { dni: nextDni() }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ex-empleado/);
    expect(await db.Employee.count({ paranoid: false })).toBe(1);
    expect((await db.Candidate.findByPk(candidate.id)).employee_id).toBeNull();
    expect((await db.CandidateApplication.findByPk(application.id)).stage).toBe("interview");
  });

  it("bloquea si el DNI cargado en el alta es de un ex-empleado aunque el del postulante sea otro", async () => {
    const actor = await createActor({ permissions: BOTH });
    const former = await db.Employee.create({ name: "L", lastname: "G", dni: "31222333", cuil: "20312223334", hire_date: "2024-01-01", hourly_rate: 1000, status: "inactive", termination_date: "2025-01-01" });
    const candidate = await createCandidate({ dni: null, cuil: null });
    await createApplication(candidate);

    const res = await as(actor).post("/employees").send(employeeBody(candidate, { dni: former.dni, cuil: "20301234563" }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ex-empleado/);
  });

  it("bloquea si el DNI del postulante ya es de un empleado actual", async () => {
    const actor = await createActor({ permissions: BOTH });
    const current = await db.Employee.create({ name: "L", lastname: "G", dni: nextDni(), cuil: "20311111118", hire_date: "2024-01-01", hourly_rate: 1000, status: "active" });
    const candidate = await createCandidate({ dni: current.dni });
    await createApplication(candidate);

    const res = await as(actor).post("/employees").send(employeeBody(candidate, { dni: nextDni() }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/empleado actual/);
    expect(await db.Employee.count()).toBe(1);
  });

  it("si el alta falla a mitad de camino, deshace todo: el postulante no queda contratado", async () => {
    const actor = await createActor({ permissions: BOTH });
    const candidate = await createCandidate();
    const application = await createApplication(candidate);

    // user_id inexistente: viola la FK recién al insertar el empleado, ya dentro de la transacción.
    const res = await as(actor).post("/employees").send(employeeBody(candidate, { user_id: 999999 }));

    expect(res.status).toBe(400);
    expect(await db.Employee.count()).toBe(0);
    expect((await db.Candidate.findByPk(candidate.id)).employee_id).toBeNull();
    expect((await db.CandidateApplication.findByPk(application.id)).stage).toBe("interview");
    expect(await db.CandidateApplicationLog.count({ where: { event: "converted" } })).toBe(0);
  });

  it("un alta sin candidate_id sigue funcionando igual y no toca postulantes", async () => {
    const actor = await createActor({ permissions: ["employees_write"] });
    const candidate = await createCandidate();
    await createApplication(candidate);

    const res = await as(actor).post("/employees").send({ name: "Otro", lastname: "Empleado", dni: nextDni(), cuil: "20300000007", hire_date: "2026-12-01", hourly_rate: 1000 });

    expect(res.status).toBe(201);
    expect((await db.Candidate.findByPk(candidate.id)).employee_id).toBeNull();
  });
});

describe("después de la conversión", () => {
  it("el detalle del postulante muestra al empleado y no lo marca como empleado actual", async () => {
    const actor = await createActor({ permissions: [...BOTH, "candidates_read"] });
    const candidate = await createCandidate();
    await createApplication(candidate);
    await as(actor).post("/employees").send(employeeBody(candidate));

    const res = await as(actor).get(`/candidates/${candidate.id}`);

    expect(res.body.data.employee).toMatchObject({ name: "María" });
    expect(res.body.data.current_employee).toBeNull();
  });

  it("ya no se puede cambiar de etapa ni crear postulaciones nuevas", async () => {
    const actor = await createActor({ permissions: [...BOTH, "candidates_write"] });
    const candidate = await createCandidate();
    const application = await createApplication(candidate);
    await as(actor).post("/employees").send(employeeBody(candidate));

    const stage = await as(actor).put(`/candidates/${candidate.id}/applications/${application.id}/stage`).send({ stage: "screening" });
    const create = await as(actor).post(`/candidates/${candidate.id}/applications`).send({});

    expect(stage.status).toBe(400);
    expect(create.status).toBe(400);
  });
});

describe("GET /employees/:id — postulación de origen", () => {
  it("incluye el postulante de origen a quien tiene candidates_read", async () => {
    const creator = await createActor({ permissions: BOTH });
    const reader = await createActor({ permissions: ["employees_read", "candidates_read"] });
    const candidate = await createCandidate();
    await createApplication(candidate);
    const created = await as(creator).post("/employees").send(employeeBody(candidate));

    const res = await as(reader).get(`/employees/${created.body.data.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.origin_candidate).toMatchObject({ id: candidate.id, name: "María", lastname: "López" });
    expect(Number.isNaN(new Date(res.body.data.origin_candidate.converted_at).getTime())).toBe(false);
  });

  it("no lo incluye sin candidates_read", async () => {
    const creator = await createActor({ permissions: BOTH });
    const reader = await createActor({ permissions: ["employees_read"] });
    const candidate = await createCandidate();
    await createApplication(candidate);
    const created = await as(creator).post("/employees").send(employeeBody(candidate));

    const res = await as(reader).get(`/employees/${created.body.data.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.origin_candidate).toBeUndefined();
  });

  it("para un empleado que no viene de un postulante, origin_candidate es null", async () => {
    const reader = await createActor({ permissions: ["employees_read", "candidates_read"] });
    const employee = await db.Employee.create({ name: "L", lastname: "G", dni: nextDni(), cuil: "20311111118", hire_date: "2024-01-01", hourly_rate: 1000 });

    const res = await as(reader).get(`/employees/${employee.id}`);

    expect(res.body.data.origin_candidate).toBeNull();
  });

  it("sigue ocultando el sueldo sin employee_salaries_read", async () => {
    const reader = await createActor({ permissions: ["employees_read"] });
    const employee = await db.Employee.create({ name: "L", lastname: "G", dni: nextDni(), cuil: "20311111118", hire_date: "2024-01-01", hourly_rate: 1000 });

    const res = await as(reader).get(`/employees/${employee.id}`);

    expect(res.body.data.hourly_rate).toBeUndefined();
  });
});
