"use strict";
// Facturar OCAs (PLAN_ARCA.md etapa 10, FLOWS.md §74). ARCA y R2 simulados.
jest.mock("../../helpers/r2Storage", () => ({
  ...jest.requireActual("../../helpers/r2Storage"),
  uploadToR2: jest.fn(async (file, folder) => `https://files.test/${folder}/${file.originalname}`),
  deleteFromR2: jest.fn(async () => {}),
}));

const db = require("../../models");
const { todayInArgentina } = require("../../helpers/argentinaDate");
const { createActor, as } = require("../helpers/auth");
const { createClient, createBudget, createBudgetItemType } = require("../factories/budget");

const TODAY = todayInArgentina();
const PERMS = ["invoices_read", "invoices_write", "invoices_update", "invoices_delete", "invoices_correct"];
let counter = 0;
let invoiceNumber = 0;

async function setup() {
  const actor = await createActor({ permissions: PERMS });
  const admin = await createActor({ role: "admin" });
  const client = await createClient();
  const project = await db.Project.create({ code: `P-OCA-${++counter}`, name: "Planta", client_id: client.id, created_by: actor.user.id });
  return { actor, admin, client, project };
}

// OCA de horas hombre aprobada, 16 hs simples + 2 al 50% a $10.000 la hora => 190.000 neto.
async function createOca(ctx, overrides = {}, lineOverrides = {}) {
  const oca = await db.Oca.create({
    number: `OCA-TEST-${++counter}`, type: "man_hours", date: "2026-11-10", client_id: ctx.client.id, project_id: ctx.project.id,
    status: "aprobado", hourly_rate: 10000, ...overrides,
  });
  await db.OcaLine.create({ oca_id: oca.id, project_id: ctx.project.id, date: "2026-11-10", regular_hours: 16, overtime_50_hours: 2, type: oca.type, ...lineOverrides });
  return oca;
}

const post = (actor, body) => as(actor).post("/invoices").send({
  voucher_type: "A", pos_number: 1, number: ++invoiceNumber, issue_date: TODAY, currency: "ARS", iva_rate: 21, ...body,
});

describe("OCAs facturables", () => {
  it("lista las OCA aprobadas del cliente con su importe, sus horas y si se pueden facturar", async () => {
    const ctx = await setup();
    const ok = await createOca(ctx);
    await createOca(ctx, { status: "pendiente" });
    await createOca(ctx, { hourly_rate: null });
    await createOca(ctx, { requires_budget: true, budget_status: "presentado" });
    const res = await as(ctx.actor).get(`/invoices/billable-ocas?client_id=${ctx.client.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3); // la pendiente no se lista
    const row = res.body.data.find((o) => o.id === ok.id);
    expect(row).toMatchObject({ net_amount: 190000, billable: true, problems: [], invoice: null, hours: { regular: 16, ot50: 2, ot100: 0, total: 18 } });
    expect(res.body.data.filter((o) => !o.billable).map((o) => o.problems.length)).toEqual([1, 1]);
  });

  it("otro cliente no ve estas OCA, y pide el cliente", async () => {
    const ctx = await setup();
    await createOca(ctx);
    const other = await createClient();
    expect((await as(ctx.actor).get(`/invoices/billable-ocas?client_id=${other.id}`)).body.data).toEqual([]);
    expect((await as(ctx.actor).get("/invoices/billable-ocas")).status).toBe(400);
  });
});

describe("factura con una OCA", () => {
  it("cobra la OCA entera: el importe sale de las horas (el que manda el cliente se ignora), con el cliente y el proyecto de la OCA", async () => {
    const ctx = await setup();
    const oca = await createOca(ctx);
    const res = await post(ctx.actor, { lines: [{ oca_id: oca.id, net_amount: 1 }] });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ client_id: ctx.client.id, project_id: ctx.project.id, budget_id: null, net_amount: 190000, iva_amount: 39900, total_amount: 229900 });
    expect(res.body.data.lines[0]).toMatchObject({ concept: "oca", oca_id: oca.id, percent: 100, net_amount: 190000, budget_id: null });
    expect(res.body.data.lines[0].description).toBe(`Hora hombre OCA ${oca.number}`);
    expect(res.body.data.lines[0].oca).toMatchObject({ id: oca.id, number: oca.number });
  });

  it("la descripción se puede escribir (por ejemplo, con la OC del cliente)", async () => {
    const ctx = await setup();
    const oca = await createOca(ctx);
    const res = await post(ctx.actor, { lines: [{ oca_id: oca.id, description: "Hora hombre, construcción 4773 OC 117242-104" }] });
    expect(res.body.data.lines[0].description).toBe("Hora hombre, construcción 4773 OC 117242-104");
  });

  it("una OCA de grúa suma las horas de cada vehículo por su valor hora", async () => {
    const ctx = await setup();
    const v1 = await db.Vehicle.create({ plate: "AA111AA", type: "crane", brand: "Liebherr", model: "LTM" });
    const v2 = await db.Vehicle.create({ plate: "BB222BB", type: "crane", brand: "Grove", model: "GMK" });
    const oca = await db.Oca.create({ number: `OCA-GRUA-${++counter}`, type: "crane_hours", date: "2026-11-10", client_id: ctx.client.id, project_id: ctx.project.id, status: "aprobado" });
    await db.OcaLine.create({ oca_id: oca.id, project_id: ctx.project.id, vehicle_id: v1.id, date: "2026-11-10", regular_hours: 6, overtime_50_hours: 2, type: "crane_hours", hourly_rate: 50000 });
    await db.OcaLine.create({ oca_id: oca.id, project_id: ctx.project.id, vehicle_id: v2.id, date: "2026-11-10", regular_hours: 4, type: "crane_hours", hourly_rate: 80000 });
    const res = await post(ctx.actor, { lines: [{ oca_id: oca.id }] });
    expect(res.status).toBe(201);
    expect(res.body.data.net_amount).toBe(8 * 50000 + 4 * 80000);
    expect(res.body.data.lines[0].description).toBe(`Servicio de grúa OCA ${oca.number}`);
  });

  it("varias OCA en una factura, cada una con su línea", async () => {
    const ctx = await setup();
    const a = await createOca(ctx);
    const b = await createOca(ctx, { hourly_rate: 20000 });
    const res = await post(ctx.actor, { lines: [{ oca_id: a.id }, { oca_id: b.id }] });
    expect(res.status).toBe(201);
    expect(res.body.data.lines).toHaveLength(2);
    expect(res.body.data.net_amount).toBe(190000 + 380000);
  });

  it("se factura en pesos", async () => {
    const ctx = await setup();
    const oca = await createOca(ctx);
    const res = await post(ctx.actor, { currency: "USD", exchange_rate: 1000, lines: [{ oca_id: oca.id }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/en pesos/);
  });

  it.each([
    ["sin aprobar", { status: "presentado" }, /no está aprobada/],
    ["sin valor hora", { hourly_rate: null }, /valor hora/],
    ["con presupuesto sin aprobar", { requires_budget: true, budget_status: "pendiente" }, /presupuesto de la OCA/],
  ])("no factura una OCA %s", async (_label, overrides, message) => {
    const ctx = await setup();
    const oca = await createOca(ctx, overrides);
    const res = await post(ctx.actor, { lines: [{ oca_id: oca.id }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
    expect(await db.Invoice.count()).toBe(0);
  });

  it("la misma OCA dos veces en una factura se rechaza", async () => {
    const ctx = await setup();
    const oca = await createOca(ctx);
    const res = await post(ctx.actor, { lines: [{ oca_id: oca.id }, { oca_id: oca.id }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/repetida/);
  });

  it("una OCA inexistente es 404", async () => {
    const ctx = await setup();
    expect((await post(ctx.actor, { client_id: ctx.client.id, lines: [{ oca_id: 999999 }] })).status).toBe(404);
  });

  it("no mezcla OCA de clientes distintos", async () => {
    const ctx = await setup();
    const a = await createOca(ctx);
    const otherClient = await createClient();
    const otherProject = await db.Project.create({ code: `P-OCA-${++counter}`, name: "Otra", client_id: otherClient.id, created_by: ctx.actor.user.id });
    const b = await createOca({ ...ctx, client: otherClient, project: otherProject }, { client_id: otherClient.id, project_id: otherProject.id });
    const res = await post(ctx.actor, { lines: [{ oca_id: a.id }, { oca_id: b.id }] });
    expect(res.status).toBe(400);
  });

  it("se puede mezclar con líneas de un presupuesto del mismo cliente, y no toca sus saldos", async () => {
    const ctx = await setup();
    const budget = await createBudget({ clientId: ctx.client.id, createdBy: ctx.actor.user.id, status: "approved", approved_at: new Date() });
    await db.BudgetLaborLine.create({ budget_id: budget.id, budget_item_type_id: (await createBudgetItemType()).id, quantity: 10, unit_price: 10000, estimated_total: 100000, currency: "ARS" });
    const oca = await createOca(ctx);
    const res = await post(ctx.actor, { lines: [{ concept: "labor", budget_id: budget.id, percent: 10 }, { oca_id: oca.id }] });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ budget_id: budget.id, net_amount: 10000 + 190000 });
    const d = (await as(ctx.actor).get(`/invoices/billables/${budget.id}`)).body.data;
    expect(d.billing.billed.ARS.labor).toBe(10000);
    // Otro cliente: no.
    const other = await createClient();
    const foreign = await createOca({ ...ctx, client: other }, { client_id: other.id, project_id: null });
    expect((await post(ctx.actor, { lines: [{ concept: "labor", budget_id: budget.id, percent: 10 }, { oca_id: foreign.id }] })).status).toBe(400);
  });

  it("una OCA no afecta ningún saldo de presupuesto", async () => {
    const ctx = await setup();
    const budget = await createBudget({ clientId: ctx.client.id, createdBy: ctx.actor.user.id, status: "approved", approved_at: new Date() });
    await db.BudgetLaborLine.create({ budget_id: budget.id, budget_item_type_id: (await createBudgetItemType()).id, quantity: 10, unit_price: 10000, estimated_total: 100000, currency: "ARS" });
    const oca = await createOca(ctx);
    await post(ctx.actor, { lines: [{ oca_id: oca.id }] });
    const d = (await as(ctx.actor).get(`/invoices/billables/${budget.id}`)).body.data;
    expect(d.billing.billed.ARS).toEqual({ materials: 0, labor: 0 });
    expect(d.invoices).toEqual([]);
  });
});

describe("una OCA se factura una sola vez", () => {
  it("mientras la factura esté vigente, la OCA no se vuelve a facturar", async () => {
    const ctx = await setup();
    const oca = await createOca(ctx);
    expect((await post(ctx.actor, { lines: [{ oca_id: oca.id }] })).status).toBe(201);
    const again = await post(ctx.actor, { lines: [{ oca_id: oca.id }] });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/ya está facturada/);
    const row = (await as(ctx.actor).get(`/invoices/billable-ocas?client_id=${ctx.client.id}`)).body.data[0];
    expect(row).toMatchObject({ billable: false, invoice: expect.objectContaining({ voucher_type: "A" }) });
  });

  it("anular la factura libera la OCA", async () => {
    const ctx = await setup();
    const oca = await createOca(ctx);
    const created = (await post(ctx.actor, { lines: [{ oca_id: oca.id }] })).body.data;
    expect((await as(ctx.actor).put(`/invoices/${created.id}/cancel`).send({ reason: "Error" })).status).toBe(200);
    expect((await post(ctx.actor, { lines: [{ oca_id: oca.id }] })).status).toBe(201);
  });

  it("corregir la factura no choca con su propia OCA", async () => {
    const ctx = await setup();
    const oca = await createOca(ctx);
    const created = (await post(ctx.actor, { lines: [{ oca_id: oca.id }] })).body.data;
    const res = await as(ctx.actor).put(`/invoices/${created.id}`).send({
      voucher_type: "A", pos_number: 1, number: created.number, issue_date: TODAY, currency: "ARS", iva_rate: 21, lines: [{ oca_id: oca.id, description: "Corregida" }],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.lines[0].description).toBe("Corregida");
  });

  it("dos facturas simultáneas de la misma OCA: una se crea y la otra se rechaza", async () => {
    const ctx = await setup();
    const oca = await createOca(ctx);
    const results = await Promise.all([post(ctx.actor, { lines: [{ oca_id: oca.id }] }), post(ctx.actor, { lines: [{ oca_id: oca.id }] })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await db.InvoiceLine.count({ where: { oca_id: oca.id } })).toBe(1);
  });

  it("una nota de crédito sobre la factura no arrastra la OCA: al anularse la factura, la OCA queda libre", async () => {
    const ctx = await setup();
    const oca = await createOca(ctx);
    const pos = await db.CompanyPointOfSale.create({ number: 3, usage_description: "Obras", type: "web_service" });
    const draft = (await as(ctx.actor).post("/invoices").send({
      source: "arca", cbte_tipo: 1, point_of_sale_id: pos.id, arca_concept: 1, issue_date: TODAY, currency: "ARS", iva_rate: 21, lines: [{ oca_id: oca.id }],
    })).body.data;
    await db.Invoice.update({ arca_status: "authorized", number: ++invoiceNumber, cae: "76123456789012", pos_number: 3 }, { where: { id: draft.id } });
    const original = (await as(ctx.actor).get(`/invoices/${draft.id}`)).body.data;
    const note = await as(ctx.actor).post("/invoices").send({
      source: "arca", kind: "credit_note", associated_invoice_id: original.id, issue_date: TODAY, notes: "Anulación",
      lines: [{ credits_line_id: original.lines[0].id, percent: 100 }],
    });
    expect(note.status).toBe(201);
    expect(note.body.data.lines[0]).toMatchObject({ concept: "oca", oca_id: null });
    await db.Invoice.update({ arca_status: "authorized", number: ++invoiceNumber, cae: "76123456789013" }, { where: { id: note.body.data.id } });
    await db.Invoice.update({ status: "cancelled" }, { where: { id: original.id } }); // lo que hace la emisión de una NC total
    const row = (await as(ctx.actor).get(`/invoices/billable-ocas?client_id=${ctx.client.id}`)).body.data[0];
    expect(row.billable).toBe(true);
  });
});

describe("una OCA facturada no se modifica", () => {
  it("anular, cambiar el valor hora o sacar horas devuelve 409 mientras la factura esté vigente", async () => {
    const ctx = await setup();
    const oca = await createOca(ctx);
    const line = await db.OcaLine.findOne({ where: { oca_id: oca.id } });
    const created = (await post(ctx.actor, { lines: [{ oca_id: oca.id }] })).body.data;
    const attempts = [
      as(ctx.admin).put(`/ocas/${oca.id}/annul`).send({ reason: "x" }),
      as(ctx.admin).put(`/ocas/${oca.id}/hourly-rate`).send({ hourly_rate: 12000 }),
      as(ctx.admin).delete(`/ocas/${oca.id}/lines/${line.id}`),
      as(ctx.admin).put(`/ocas/${oca.id}/reject`).send({ reason: "x" }),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("oca_billed");
    }
    expect((await db.Oca.findByPk(oca.id)).status).toBe("aprobado");
    // Anulada la factura, el bloqueo se levanta.
    await as(ctx.actor).put(`/invoices/${created.id}/cancel`).send({ reason: "Error" });
    expect((await as(ctx.admin).put(`/ocas/${oca.id}/hourly-rate`).send({ hourly_rate: 12000 })).status).not.toBe(409);
  });

  it("el listado de OCAs trae la factura que la cobra", async () => {
    const ctx = await setup();
    const oca = await createOca(ctx);
    const created = (await post(ctx.actor, { lines: [{ oca_id: oca.id }] })).body.data;
    const list = (await as(ctx.admin).get("/ocas")).body.data;
    expect(list.find((o) => o.id === oca.id).billed_invoice).toMatchObject({ id: created.id });
  });
});

describe("permisos", () => {
  it("listar las OCA facturables pide invoices_read", async () => {
    const ctx = await setup();
    const without = await createActor({ permissions: ["ocas_read"] });
    expect((await as(without).get(`/invoices/billable-ocas?client_id=${ctx.client.id}`)).status).toBe(401);
    expect((await as(ctx.actor).get(`/invoices/billable-ocas?client_id=${ctx.client.id}`)).status).toBe(200);
  });
});
