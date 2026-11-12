"use strict";
// Horas manuales de proyectos/adicionales (FLOWS.md §56): alta, listado y anulación en
// /time-entries/manual. Reusan los permisos de carga de horas (time_entries_read/write/update) porque
// cuelgan de /time-entries/. Requiere la tabla ProjectManualHours (migración 20261112110001).
const db = require("../../models");
const { createActor, as } = require("../helpers/auth");
const { createClient, createBudgetItemType } = require("../factories/budget");
const { todayInArgentina } = require("../../helpers/argentinaDate");

let counter = 0;

async function createProject({ status = "active", is_additional = false, hourBuckets = [] } = {}) {
  counter += 1;
  const client = await createClient();
  const project = await db.Project.create({
    name: `Proyecto Horas ${counter}`,
    code: `PH-${counter}-${Math.floor(Math.random() * 1e6)}`,
    client_id: client.id,
    is_additional,
    status,
    start_date: "2026-11-01",
  });
  for (const { itemType, hours } of hourBuckets) {
    await db.ProjectHourBudget.create({
      project_id: project.id,
      budget_item_type_id: itemType ? itemType.id : null,
      budgeted_hours: hours,
    });
  }
  return project;
}

const body = (project, itemType, overrides = {}) => ({
  project_id: project.id,
  budget_item_type_id: itemType ? itemType.id : null,
  hours: 15,
  description: "Armado en taller",
  ...overrides,
});

describe("POST /time-entries/manual", () => {
  it("registra horas manuales de un rubro con bolsa y devuelve el detalle", async () => {
    const actor = await createActor({ permissions: ["time_entries_write"] });
    const construccion = await createBudgetItemType();
    const project = await createProject({ hourBuckets: [{ itemType: construccion, hours: 20 }] });

    const res = await as(actor).post("/time-entries/manual").send(body(project, construccion));

    expect(res.status).toBe(201);
    expect(res.body.data.hours).toBe(15);
    expect(res.body.data.status).toBe("active");
    expect(res.body.data.date).toBe(todayInArgentina());
    expect(res.body.data.itemType.id).toBe(construccion.id);
    expect(res.body.data.author.id).toBe(actor.user.id);
    const row = await db.ProjectManualHour.findByPk(res.body.data.id);
    expect(row.created_by).toBe(actor.user.id);
    expect(row.description).toBe("Armado en taller");
  });

  it("sin rubro las horas van a Generales, aunque no haya bolsa general", async () => {
    const actor = await createActor({ permissions: ["time_entries_write"] });
    const project = await createProject();

    const res = await as(actor).post("/time-entries/manual").send(body(project, null));

    expect(res.status).toBe(201);
    expect(res.body.data.budget_item_type_id).toBeNull();
  });

  it("funciona también en un adicional", async () => {
    const actor = await createActor({ permissions: ["time_entries_write"] });
    const project = await createProject({ is_additional: true });

    const res = await as(actor).post("/time-entries/manual").send(body(project, null));

    expect(res.status).toBe(201);
  });

  it("deja guardar horas de más: pasarse de la bolsa no bloquea", async () => {
    const actor = await createActor({ permissions: ["time_entries_write"] });
    const montaje = await createBudgetItemType();
    const project = await createProject({ hourBuckets: [{ itemType: montaje, hours: 5 }] });

    const res = await as(actor).post("/time-entries/manual").send(body(project, montaje, { hours: 40 }));

    expect(res.status).toBe(201);
  });

  it("rechaza un rubro sin bolsa en ese proyecto", async () => {
    const actor = await createActor({ permissions: ["time_entries_write"] });
    const sinBolsa = await createBudgetItemType();
    const project = await createProject();

    const res = await as(actor).post("/time-entries/manual").send(body(project, sinBolsa));

    expect(res.status).toBe(400);
  });

  it("rechaza un proyecto finalizado o cancelado", async () => {
    const actor = await createActor({ permissions: ["time_entries_write"] });
    const completed = await createProject({ status: "completed" });
    const cancelled = await createProject({ status: "cancelled" });

    const resCompleted = await as(actor).post("/time-entries/manual").send(body(completed, null));
    const resCancelled = await as(actor).post("/time-entries/manual").send(body(cancelled, null));

    expect(resCompleted.status).toBe(400);
    expect(resCancelled.status).toBe(400);
  });

  it("rechaza un proyecto que no existe", async () => {
    const actor = await createActor({ permissions: ["time_entries_write"] });

    const res = await as(actor).post("/time-entries/manual").send({ project_id: 999999, hours: 1, description: "x" });

    expect(res.status).toBe(404);
  });

  it.each([
    ["horas en cero", { hours: 0 }],
    ["horas negativas", { hours: -3 }],
    ["horas que no son un número", { hours: "abc" }],
    ["horas por encima del máximo", { hours: 10000 }],
    ["detalle vacío", { description: "   " }],
    ["sin detalle", { description: undefined }],
    ["fecha inválida", { date: "2026-13-45" }],
    ["fecha futura", { date: "2999-01-01" }],
  ])("rechaza %s", async (_label, overrides) => {
    const actor = await createActor({ permissions: ["time_entries_write"] });
    const project = await createProject();

    const res = await as(actor).post("/time-entries/manual").send(body(project, null, overrides));

    expect(res.status).toBe(400);
    expect(await db.ProjectManualHour.count({ where: { project_id: project.id } })).toBe(0);
  });

  it("acepta una fecha pasada", async () => {
    const actor = await createActor({ permissions: ["time_entries_write"] });
    const project = await createProject();

    const res = await as(actor).post("/time-entries/manual").send(body(project, null, { date: "2026-10-05" }));

    expect(res.status).toBe(201);
    expect(res.body.data.date).toBe("2026-10-05");
  });

  it("rechaza sin time_entries_write", async () => {
    const actor = await createActor({ permissions: ["time_entries_read"] });
    const project = await createProject();

    const res = await as(actor).post("/time-entries/manual").send(body(project, null));

    expect(res.status).toBe(401);
  });

  it("permite al admin (admin_granted)", async () => {
    const actor = await createActor({ role: "admin" });
    const project = await createProject();

    const res = await as(actor).post("/time-entries/manual").send(body(project, null));

    expect(res.status).toBe(201);
  });
});

describe("GET /time-entries/manual", () => {
  it("lista las horas del proyecto, activas y anuladas, las más nuevas primero", async () => {
    const actor = await createActor({ permissions: ["time_entries_read", "time_entries_write", "time_entries_update"] });
    const project = await createProject();
    const first = (await as(actor).post("/time-entries/manual").send(body(project, null, { description: "Primera" }))).body.data;
    const second = (await as(actor).post("/time-entries/manual").send(body(project, null, { description: "Segunda" }))).body.data;
    await as(actor).put(`/time-entries/manual/${first.id}/void`).send({ void_reason: "Me equivoqué" });

    const res = await as(actor).get("/time-entries/manual").query({ project_id: project.id });

    expect(res.status).toBe(200);
    expect(res.body.data.map((e) => e.id)).toEqual([second.id, first.id]);
    expect(res.body.data[1].status).toBe("voided");
    expect(res.body.data[1].void_reason).toBe("Me equivoqué");
    expect(res.body.data[1].voider.id).toBe(actor.user.id);
    expect(res.body.data[0].created_at).toBeTruthy();
  });

  it("no mezcla las horas de otro proyecto", async () => {
    const actor = await createActor({ permissions: ["time_entries_read", "time_entries_write"] });
    const mine = await createProject();
    const other = await createProject();
    await as(actor).post("/time-entries/manual").send(body(other, null));

    const res = await as(actor).get("/time-entries/manual").query({ project_id: mine.id });

    expect(res.body.data).toEqual([]);
  });

  it("devuelve 400 sin project_id y 404 con un proyecto inexistente", async () => {
    const actor = await createActor({ permissions: ["time_entries_read"] });

    expect((await as(actor).get("/time-entries/manual")).status).toBe(400);
    expect((await as(actor).get("/time-entries/manual").query({ project_id: 999999 })).status).toBe(404);
  });

  it("rechaza sin time_entries_read", async () => {
    const actor = await createActor();
    const project = await createProject();

    const res = await as(actor).get("/time-entries/manual").query({ project_id: project.id });

    expect(res.status).toBe(401);
  });

  it("permite al admin (admin_granted)", async () => {
    const actor = await createActor({ role: "admin" });
    const project = await createProject();

    const res = await as(actor).get("/time-entries/manual").query({ project_id: project.id });

    expect(res.status).toBe(200);
  });
});

describe("PUT /time-entries/manual/:id/void", () => {
  const createEntry = async (project) => db.ProjectManualHour.create({
    project_id: project.id, hours: 10, date: "2026-11-02", description: "Horas", created_by: (await createActor()).user.id,
  });

  it("anula con motivo y deja registrado quién y cuándo", async () => {
    const actor = await createActor({ permissions: ["time_entries_update"] });
    const project = await createProject();
    const entry = await createEntry(project);

    const res = await as(actor).put(`/time-entries/manual/${entry.id}/void`).send({ void_reason: "Carga duplicada" });

    expect(res.status).toBe(200);
    const row = await db.ProjectManualHour.findByPk(entry.id);
    expect(row.status).toBe("voided");
    expect(row.voided_by).toBe(actor.user.id);
    expect(row.voided_at).toBeTruthy();
    expect(row.void_reason).toBe("Carga duplicada");
  });

  it("exige el motivo", async () => {
    const actor = await createActor({ permissions: ["time_entries_update"] });
    const entry = await createEntry(await createProject());

    const res = await as(actor).put(`/time-entries/manual/${entry.id}/void`).send({ void_reason: "  " });

    expect(res.status).toBe(400);
    expect((await db.ProjectManualHour.findByPk(entry.id)).status).toBe("active");
  });

  it("no se puede anular dos veces", async () => {
    const actor = await createActor({ permissions: ["time_entries_update"] });
    const entry = await createEntry(await createProject());
    await as(actor).put(`/time-entries/manual/${entry.id}/void`).send({ void_reason: "Una vez" });

    const res = await as(actor).put(`/time-entries/manual/${entry.id}/void`).send({ void_reason: "Otra vez" });

    expect(res.status).toBe(400);
  });

  it("devuelve 404 con un registro inexistente", async () => {
    const actor = await createActor({ permissions: ["time_entries_update"] });

    const res = await as(actor).put("/time-entries/manual/999999/void").send({ void_reason: "x" });

    expect(res.status).toBe(404);
  });

  it("rechaza sin time_entries_update", async () => {
    const actor = await createActor({ permissions: ["time_entries_write"] });
    const entry = await createEntry(await createProject());

    const res = await as(actor).put(`/time-entries/manual/${entry.id}/void`).send({ void_reason: "x" });

    expect(res.status).toBe(401);
  });

  it("permite al admin (admin_granted)", async () => {
    const actor = await createActor({ role: "admin" });
    const entry = await createEntry(await createProject());

    const res = await as(actor).put(`/time-entries/manual/${entry.id}/void`).send({ void_reason: "x" });

    expect(res.status).toBe(200);
  });
});

describe("borrado de proyectos y adicionales con horas manuales", () => {
  const addManual = async (project, status = "active") => db.ProjectManualHour.create({
    project_id: project.id, hours: 4, date: "2026-11-02", description: "Horas", status, created_by: (await createActor()).user.id,
  });

  it("no deja eliminar un proyecto con horas manuales activas", async () => {
    const actor = await createActor({ permissions: ["projects_delete"] });
    const project = await createProject();
    await addManual(project);

    const res = await as(actor).delete(`/projects/${project.id}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("horas manuales");
    expect(await db.Project.findByPk(project.id)).not.toBeNull();
  });

  it("deja eliminar un proyecto si sus horas manuales están anuladas", async () => {
    const actor = await createActor({ permissions: ["projects_delete"] });
    const project = await createProject();
    await addManual(project, "voided");

    const res = await as(actor).delete(`/projects/${project.id}`);

    expect(res.status).toBe(200);
  });

  it("no deja eliminar un adicional con horas manuales activas", async () => {
    const actor = await createActor({ permissions: ["additionals_delete"] });
    const project = await createProject({ is_additional: true });
    await addManual(project);

    const res = await as(actor).delete(`/additionals/${project.id}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("horas manuales");
    expect(await db.Project.findByPk(project.id)).not.toBeNull();
  });
});
