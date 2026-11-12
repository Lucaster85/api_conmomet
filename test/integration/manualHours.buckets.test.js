"use strict";
// Qué cuentan las horas manuales (FLOWS.md §56): suman a la bolsa del rubro junto con las horas de
// empleados y se ven desglosadas, las anuladas no cuentan, y NO aparecen en la carga de horas de
// empleados. También el detalle del adicional, que ahora trae las barras por rubro.
const db = require("../../models");
const { createActor, as } = require("../helpers/auth");
const { createClient, createBudgetItemType } = require("../factories/budget");
const { buildHourBuckets, sumConsumedHoursByType } = require("../../services/projectHoursService");

let counter = 0;

async function createProject({ is_additional = false } = {}) {
  counter += 1;
  const client = await createClient();
  return db.Project.create({
    name: `Proyecto Barras ${counter}`,
    code: `PB-${counter}-${Math.floor(Math.random() * 1e6)}`,
    client_id: client.id,
    is_additional,
    status: "active",
    start_date: "2026-11-01",
  });
}

const addBucket = (project, itemType, hours) => db.ProjectHourBudget.create({
  project_id: project.id, budget_item_type_id: itemType ? itemType.id : null, budgeted_hours: hours,
});

let authorId;
const addManual = async (project, itemType, hours, status = "active") => {
  if (!authorId) authorId = (await createActor()).user.id;
  return db.ProjectManualHour.create({
    project_id: project.id,
    budget_item_type_id: itemType ? itemType.id : null,
    hours, date: "2026-11-02", description: "Horas manuales", status, created_by: authorId,
  });
};

const addEmployeeHours = async (project, itemType, hours) => {
  counter += 1;
  const employee = await db.Employee.create({
    name: "Ana", lastname: `Barras${counter}`, dni: String(32000000 + counter), cuil: String(20320000000 + counter),
    hire_date: "2024-01-01", hourly_rate: 1000,
  });
  const registrar = await createActor();
  return db.TimeEntry.create({
    employee_id: employee.id, project_id: project.id, budget_item_type_id: itemType ? itemType.id : null,
    date: "2026-11-03", check_in: "08:00", check_out: "16:00", regular_hours: hours, status: "approved",
    registered_by: registrar.user.id,
  });
};

const bucketOf = (data, projectId, itemType) =>
  data.get(projectId).hour_buckets.find((b) => b.budget_item_type_id === (itemType ? itemType.id : null));

describe("buildHourBuckets con horas manuales", () => {
  beforeEach(() => { authorId = null; });

  it("suma las manuales activas a la bolsa del rubro y muestra el desglose", async () => {
    const construccion = await createBudgetItemType();
    const project = await createProject();
    await addBucket(project, construccion, 20);
    await addManual(project, construccion, 15);

    const buckets = await buildHourBuckets([project.id]);

    const bucket = bucketOf(buckets, project.id, construccion);
    expect(bucket.budgeted_hours).toBe(20);
    expect(bucket.consumed_hours).toBe(15);
    expect(bucket.consumed_hours_manual).toBe(15);
    expect(buckets.get(project.id).consumed_hours_total).toBe(15);
    expect(buckets.get(project.id).consumed_hours_manual_total).toBe(15);
  });

  it("junta las horas de empleados y las manuales en una sola barra", async () => {
    const montaje = await createBudgetItemType();
    const project = await createProject();
    await addBucket(project, montaje, 40);
    await addEmployeeHours(project, montaje, 8);
    await addManual(project, montaje, 12);

    const buckets = await buildHourBuckets([project.id]);

    const bucket = bucketOf(buckets, project.id, montaje);
    expect(bucket.consumed_hours).toBe(20);
    expect(bucket.consumed_hours_manual).toBe(12);
  });

  it("las manuales anuladas no cuentan", async () => {
    const montaje = await createBudgetItemType();
    const project = await createProject();
    await addBucket(project, montaje, 40);
    await addManual(project, montaje, 12);
    await addManual(project, montaje, 30, "voided");

    const buckets = await buildHourBuckets([project.id]);

    expect(bucketOf(buckets, project.id, montaje).consumed_hours).toBe(12);
  });

  it("un rubro con horas manuales pero sin bolsa aparece con 0 hs presupuestadas", async () => {
    const extra = await createBudgetItemType();
    const project = await createProject();
    await addManual(project, extra, 6);

    const buckets = await buildHourBuckets([project.id]);

    const bucket = bucketOf(buckets, project.id, extra);
    expect(bucket.budgeted_hours).toBe(0);
    expect(bucket.consumed_hours).toBe(6);
  });

  it("las manuales sin rubro van a Generales", async () => {
    const project = await createProject();
    await addManual(project, null, 3);

    const buckets = await buildHourBuckets([project.id]);

    const bucket = bucketOf(buckets, project.id, null);
    expect(bucket.item_type_name).toBe("Generales");
    expect(bucket.consumed_hours).toBe(3);
  });

  it("no mezcla las horas de un proyecto con las de otro", async () => {
    const construccion = await createBudgetItemType();
    const a = await createProject();
    const b = await createProject();
    await addBucket(a, construccion, 10);
    await addBucket(b, construccion, 10);
    await addManual(a, construccion, 7);

    const buckets = await buildHourBuckets([a.id, b.id]);

    expect(bucketOf(buckets, a.id, construccion).consumed_hours).toBe(7);
    expect(bucketOf(buckets, b.id, construccion).consumed_hours).toBe(0);
  });

  it("sumConsumedHoursByType (el que usan listados y presupuesto) incluye las manuales", async () => {
    const construccion = await createBudgetItemType();
    const project = await createProject();
    await addEmployeeHours(project, construccion, 8);
    await addManual(project, construccion, 5);

    const map = await sumConsumedHoursByType([project.id]);

    expect(map.get(project.id).get(construccion.id)).toBe(13);
  });
});

describe("las horas manuales no son horas de empleados", () => {
  beforeEach(() => { authorId = null; });

  it("GET /time-entries no las incluye", async () => {
    const actor = await createActor({ permissions: ["time_entries_read"] });
    const project = await createProject();
    await addManual(project, null, 9);

    const res = await as(actor).get("/time-entries").query({ project_id: project.id });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe("GET /additionals/:id con horas manuales", () => {
  beforeEach(() => { authorId = null; });

  it("trae las barras por rubro con el consumido (empleados + manuales) y lo presupuestado con budgets_read", async () => {
    const actor = await createActor({ permissions: ["additionals_read", "budgets_read"] });
    const construccion = await createBudgetItemType();
    const project = await createProject({ is_additional: true });
    await addBucket(project, construccion, 20);
    await addEmployeeHours(project, construccion, 4);
    await addManual(project, construccion, 15);

    const res = await as(actor).get(`/additionals/${project.id}`);

    expect(res.status).toBe(200);
    const bucket = res.body.data.hour_buckets.find((b) => b.budget_item_type_id === construccion.id);
    expect(bucket.budgeted_hours).toBe(20);
    expect(bucket.consumed_hours).toBe(19);
    expect(bucket.consumed_hours_manual).toBe(15);
    expect(res.body.data.consumed_hours_own).toBe(19);
  });

  it("sin budgets_read saca lo presupuestado y deja solo el consumido", async () => {
    const actor = await createActor({ permissions: ["additionals_read"] });
    const construccion = await createBudgetItemType();
    const project = await createProject({ is_additional: true });
    await addBucket(project, construccion, 20);
    await addManual(project, construccion, 15);

    const res = await as(actor).get(`/additionals/${project.id}`);

    const bucket = res.body.data.hour_buckets.find((b) => b.budget_item_type_id === construccion.id);
    expect(bucket.consumed_hours).toBe(15);
    expect(bucket).not.toHaveProperty("budgeted_hours");
  });
});
