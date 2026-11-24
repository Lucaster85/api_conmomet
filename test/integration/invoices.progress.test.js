"use strict";
// Avance real de obra, medición paralela a la de horas (PLAN_ARCA.md etapa 9, FLOWS.md §72). R2 simulado.
jest.mock("../../helpers/r2Storage", () => ({
  ...jest.requireActual("../../helpers/r2Storage"),
  uploadToR2: jest.fn(async (file, folder) => `https://files.test/${folder}/${file.originalname}`),
  deleteFromR2: jest.fn(async () => {}),
}));

const db = require("../../models");
const r2 = require("../../helpers/r2Storage");
const { todayInArgentina } = require("../../helpers/argentinaDate");
const { createActor, as } = require("../helpers/auth");
const { createClient, createBudget, createBudgetItemType, createMaterialUnit } = require("../factories/budget");

const TODAY = todayInArgentina();
const PERMS = ["invoices_read", "invoices_write", "invoices_update", "invoices_delete"];
const PDF = Buffer.from("%PDF-1.4 test");
let invoiceNumber = 0;

beforeEach(() => jest.clearAllMocks());

async function setup(budgetOverrides = {}) {
  const actor = await createActor({ permissions: PERMS });
  const client = await createClient();
  const budget = await createBudget({ clientId: client.id, createdBy: actor.user.id, status: "approved", approved_at: new Date(), ...budgetOverrides });
  const itemType = await createBudgetItemType();
  const unit = await createMaterialUnit();
  await db.BudgetLaborLine.create({ budget_id: budget.id, budget_item_type_id: itemType.id, quantity: 10, unit_price: 10000, estimated_total: 100000, currency: "ARS" });
  await db.BudgetMaterialItem.create({ budget_id: budget.id, description: "Caños", quantity: 1, material_unit_id: unit.id, unit_price: 20000, total_price: 20000, currency: "ARS" });
  return { actor, client, budget };
}

const entryBody = (budgetId, overrides = {}) => ({ budget_id: budgetId, date: "2026-11-10", percent: 30, source: "manual", ...overrides });
const create = (ctx, overrides) => as(ctx.actor).post("/invoices/progress-entries").send(entryBody(ctx.budget.id, overrides));
const detail = (ctx) => as(ctx.actor).get(`/invoices/billables/${ctx.budget.id}`).then((r) => r.body.data);
const invoice = (ctx, lines) => as(ctx.actor).post("/invoices").send({
  voucher_type: "A", pos_number: 1, number: ++invoiceNumber, issue_date: TODAY, currency: "ARS", iva_rate: 21, budget_id: ctx.budget.id, lines,
});

describe("cargar el avance real", () => {
  it("una medición manual no lleva certificado ni estado", async () => {
    const ctx = await setup();
    const res = await create(ctx, { certificate_number: "X", status: "approved" });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ source: "manual", percent: 30, certificate_number: null, status: null, counts: true });
  });

  it("un certificado pide número, queda presentado por defecto y no cuenta hasta que se aprueba", async () => {
    const ctx = await setup();
    expect((await create(ctx, { source: "certificate" })).status).toBe(400);
    const res = await create(ctx, { source: "certificate", certificate_number: "C-12" });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: "presented", certificate_number: "C-12", counts: false });
  });

  it.each([
    ["sin fecha", { date: "" }, /fecha/],
    ["con fecha inexistente", { date: "2026-02-30" }, /fecha/],
    ["en cero", { percent: 0 }, /entre 0 y 100/],
    ["sobre 100", { percent: 120 }, /entre 0 y 100/],
    ["sin porcentaje", { percent: "" }, /entre 0 y 100/],
    ["con origen inválido", { source: "otro" }, /origen/],
    ["con estado inválido", { source: "certificate", certificate_number: "C", status: "listo" }, /estado/],
  ])("rechaza un avance %s", async (_label, overrides, message) => {
    const ctx = await setup();
    const res = await create(ctx, overrides);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });

  it("solo en presupuestos aprobados", async () => {
    const ctx = await setup({ status: "draft" });
    expect((await create(ctx)).status).toBe(400);
  });

  it("el avance es acumulado: no puede bajar respecto de uno anterior ni subir sobre uno posterior", async () => {
    const ctx = await setup();
    await create(ctx, { date: "2026-10-01", percent: 20 });
    await create(ctx, { date: "2026-12-01", percent: 60 });
    expect((await create(ctx, { date: "2026-11-01", percent: 10 })).status).toBe(409);
    expect((await create(ctx, { date: "2026-11-01", percent: 70 })).status).toBe(409);
    expect((await create(ctx, { date: "2026-11-01", percent: 40 })).status).toBe(201);
  });

  it("un certificado rechazado o presentado no está sujeto a esa regla", async () => {
    const ctx = await setup();
    await create(ctx, { date: "2026-11-01", percent: 50 });
    expect((await create(ctx, { date: "2026-11-05", source: "certificate", certificate_number: "C-1", percent: 10, status: "rejected" })).status).toBe(201);
  });

  it("sube archivos del certificado y los borra de R2 con el avance", async () => {
    const ctx = await setup();
    const res = await as(ctx.actor).post("/invoices/progress-entries")
      .field("budget_id", String(ctx.budget.id)).field("date", "2026-11-10").field("percent", "30").field("source", "certificate").field("certificate_number", "C-3")
      .attach("files", PDF, { filename: "certificado.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(201);
    expect(res.body.data.files).toHaveLength(1);
    expect((await as(ctx.actor).delete(`/invoices/progress-entries/${res.body.data.id}`)).status).toBe(200);
    expect(r2.deleteFromR2).toHaveBeenCalledTimes(1);
    expect(await db.BudgetProgressEntry.count()).toBe(0);
  });

  it("agrega y quita archivos de un avance existente", async () => {
    const ctx = await setup();
    const entry = (await create(ctx)).body.data;
    const added = await as(ctx.actor).post(`/invoices/progress-entries/${entry.id}/files`).attach("files", PDF, { filename: "a.pdf", contentType: "application/pdf" });
    expect(added.body.data.files).toHaveLength(1);
    const removed = await as(ctx.actor).delete(`/invoices/progress-entries/${entry.id}/files/${added.body.data.files[0].id}`);
    expect(removed.body.data.files).toHaveLength(0);
  });
});

describe("editar un avance", () => {
  it("aprobar un certificado lo hace contar, con las mismas reglas", async () => {
    const ctx = await setup();
    await create(ctx, { date: "2026-10-01", percent: 50 });
    const certificate = (await create(ctx, { date: "2026-11-01", percent: 40, source: "certificate", certificate_number: "C-9" })).body.data;
    const res = await as(ctx.actor).put(`/invoices/progress-entries/${certificate.id}`).send(entryBody(ctx.budget.id, { date: "2026-11-01", percent: 40, source: "certificate", certificate_number: "C-9", status: "approved" }));
    expect(res.status).toBe(409); // aprobado pasaría a contar y bajaría del 50% anterior
    const ok = await as(ctx.actor).put(`/invoices/progress-entries/${certificate.id}`).send(entryBody(ctx.budget.id, { date: "2026-11-01", percent: 55, source: "certificate", certificate_number: "C-9", status: "approved" }));
    expect(ok.status).toBe(200);
    expect(ok.body.data.counts).toBe(true);
  });
});

describe("avance real en el detalle de facturación", () => {
  it("el avance vigente es la última medición que cuenta, y un certificado presentado no lo pisa", async () => {
    const ctx = await setup();
    expect((await detail(ctx)).billing.real_progress).toBeNull();
    await create(ctx, { date: "2026-11-01", percent: 30 });
    await create(ctx, { date: "2026-11-20", percent: 70, source: "certificate", certificate_number: "C-2" });
    const d = await detail(ctx);
    expect(d.billing.real_progress).toMatchObject({ percent: 30, date: "2026-11-01", source: "manual" });
    expect(d.progress_entries).toHaveLength(2);
    expect(d.progress_entries[0].date).toBe("2026-11-20"); // las más nuevas primero
  });

  it("'Facturado > avance real' avisa solo si hay avance y se facturó más", async () => {
    const ctx = await setup();
    await invoice(ctx, [{ concept: "labor", percent: 50 }]);
    expect((await detail(ctx)).billing.overbilled_vs_real).toBe(false); // sin avance real no compara
    await create(ctx, { percent: 30 });
    expect((await detail(ctx)).billing.overbilled_vs_real).toBe(true);
    await create(ctx, { date: "2026-11-20", percent: 60 });
    expect((await detail(ctx)).billing.overbilled_vs_real).toBe(false);
  });

  it("no modifica la medición por horas", async () => {
    const ctx = await setup();
    await invoice(ctx, [{ concept: "labor", percent: 50 }]);
    const before = (await detail(ctx)).billing;
    await create(ctx, { percent: 10 });
    const after = (await detail(ctx)).billing;
    expect(after.project_progress).toEqual(before.project_progress);
    expect(after.overbilled_labor).toBe(before.overbilled_labor);
    expect(after.labor_billed_percent).toBe(before.labor_billed_percent);
  });

  it("el listado también trae el avance real y el aviso", async () => {
    const ctx = await setup();
    await invoice(ctx, [{ concept: "labor", percent: 50 }]);
    await create(ctx, { percent: 30 });
    const row = (await as(ctx.actor).get("/invoices/billables")).body.data.find((r) => r.id === ctx.budget.id);
    expect(row.billing.real_progress.percent).toBe(30);
    expect(row.billing.overbilled_vs_real).toBe(true);
  });
});

describe("la línea de factura referencia el avance que factura", () => {
  it("guarda el avance en la línea y lo devuelve con la factura", async () => {
    const ctx = await setup();
    const entry = (await create(ctx, { source: "certificate", certificate_number: "C-5", status: "approved", percent: 40 })).body.data;
    const res = await invoice(ctx, [{ concept: "labor", percent: 40, progress_entry_id: entry.id }]);
    expect(res.status).toBe(201);
    expect(res.body.data.lines[0].progress_entry_id).toBe(entry.id);
    expect(res.body.data.lines[0].progressEntry).toMatchObject({ id: entry.id, percent: 40, certificate_number: "C-5" });
  });

  it("rechaza un avance de otro presupuesto, rechazado o inexistente", async () => {
    const ctx = await setup();
    const other = await createBudget({ clientId: ctx.client.id, createdBy: ctx.actor.user.id, status: "approved" });
    const foreign = (await as(ctx.actor).post("/invoices/progress-entries").send(entryBody(other.id))).body.data;
    const rejected = (await create(ctx, { source: "certificate", certificate_number: "C-6", status: "rejected" })).body.data;
    for (const id of [foreign.id, rejected.id, 999999]) {
      const res = await invoice(ctx, [{ concept: "labor", percent: 10, progress_entry_id: id }]);
      expect(res.status).toBe(400);
    }
    expect(await db.Invoice.count()).toBe(0);
  });

  it("un avance con facturas no se elimina", async () => {
    const ctx = await setup();
    const entry = (await create(ctx)).body.data;
    await invoice(ctx, [{ concept: "labor", percent: 10, progress_entry_id: entry.id }]);
    const res = await as(ctx.actor).delete(`/invoices/progress-entries/${entry.id}`);
    expect(res.status).toBe(409);
    expect(await db.BudgetProgressEntry.count()).toBe(1);
  });
});

describe("permisos", () => {
  it("cargar pide invoices_write, editar invoices_update y borrar invoices_delete", async () => {
    const ctx = await setup();
    const reader = await createActor({ permissions: ["invoices_read"] });
    const writer = await createActor({ permissions: ["invoices_write"] });
    const updater = await createActor({ permissions: ["invoices_update"] });
    expect((await as(reader).post("/invoices/progress-entries").send(entryBody(ctx.budget.id))).status).toBe(401);
    const entry = (await as(writer).post("/invoices/progress-entries").send(entryBody(ctx.budget.id))).body.data;
    expect((await as(writer).put(`/invoices/progress-entries/${entry.id}`).send(entryBody(ctx.budget.id, { percent: 35 }))).status).toBe(401);
    expect((await as(updater).put(`/invoices/progress-entries/${entry.id}`).send(entryBody(ctx.budget.id, { percent: 35 }))).status).toBe(200);
    expect((await as(writer).delete(`/invoices/progress-entries/${entry.id}`)).status).toBe(401);
    expect((await as(ctx.actor).delete(`/invoices/progress-entries/${entry.id}`)).status).toBe(200);
  });
});
