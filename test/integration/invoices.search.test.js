"use strict";
// Buscadores de Facturación por el N° de presupuesto del cliente (FLOWS.md §79): el registro de facturas
// (GET /invoices?q=, buscador nuevo) y "Por facturar" (GET /invoices/billables?q=).
const db = require("../../models");
const { todayInArgentina } = require("../../helpers/argentinaDate");
const { createActor, as } = require("../helpers/auth");
const { createClient, createBudget, createBudgetItemType } = require("../factories/budget");

const TODAY = todayInArgentina();
const PERMS = ["invoices_read", "invoices_write", "invoices_update", "invoices_delete"];

async function setup() {
  const actor = await createActor({ permissions: PERMS });
  const itemType = await createBudgetItemType();
  const pos = await db.CompanyPointOfSale.create({ number: 3, usage_description: "Obras", type: "web_service" });
  return { actor, itemType, pos };
}

// Presupuesto aprobado con mano de obra para poder facturarlo.
async function approvedBudget(ctx, overrides = {}) {
  const client = await createClient(overrides.client);
  const budget = await createBudget({
    clientId: client.id, createdBy: ctx.actor.user.id, status: "approved", approved_at: new Date(), ...overrides.budget,
  });
  await db.BudgetLaborLine.create({ budget_id: budget.id, budget_item_type_id: ctx.itemType.id, quantity: 10, unit_price: 100000, estimated_total: 1000000, currency: "ARS" });
  return { client, budget };
}

// Factura en borrador de un presupuesto (alcanza para el registro: no hace falta que esté emitida).
async function draftInvoice(ctx, budget, extra = {}) {
  const res = await as(ctx.actor).post("/invoices").send({
    source: "arca", cbte_tipo: 1, point_of_sale_id: ctx.pos.id, arca_concept: 1, issue_date: TODAY, currency: "ARS", iva_rate: 21,
    budget_id: budget.id, lines: [{ concept: "labor", percent: 50 }], ...extra,
  });
  expect(res.status).toBe(201);
  return res.body.data;
}

const ids = (res) => res.body.data.map((row) => row.id);

describe("GET /invoices?q= — buscador del registro de facturas", () => {
  it("encuentra por el N° de presupuesto del cliente y devuelve solo esas facturas", async () => {
    const ctx = await setup();
    const target = await approvedBudget(ctx, { budget: { client_budget_number: "CLI-7421-X" } });
    const other = await approvedBudget(ctx, { budget: { client_budget_number: "CLI-0001" } });
    const wanted = await draftInvoice(ctx, target.budget);
    await draftInvoice(ctx, other.budget);

    const res = await as(ctx.actor).get("/invoices").query({ q: "7421" });

    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([wanted.id]);
    // El dato llega al front para armar el texto estándar de las líneas.
    expect(res.body.data[0].budget.client_budget_number).toBe("CLI-7421-X");
    expect(res.body.data[0].lines[0].budget.client_budget_number).toBe("CLI-7421-X");
  });

  it("encuentra por nuestro N° de presupuesto, por razón social y por referencia comercial", async () => {
    const ctx = await setup();
    const target = await approvedBudget(ctx, { client: { razonSocial: "Acería Pampeana SA" } });
    const wanted = await draftInvoice(ctx, target.budget, { commercial_reference: "OC 4500123 / Obra norte" });
    const noise = await approvedBudget(ctx);
    await draftInvoice(ctx, noise.budget);

    expect(ids(await as(ctx.actor).get("/invoices").query({ q: target.budget.number }))).toEqual([wanted.id]);
    expect(ids(await as(ctx.actor).get("/invoices").query({ q: "pampeana" }))).toEqual([wanted.id]);
    expect(ids(await as(ctx.actor).get("/invoices").query({ q: "obra norte" }))).toEqual([wanted.id]);
  });

  it("encuentra por el N° de la OC de alguna línea", async () => {
    const ctx = await setup();
    const { budget } = await approvedBudget(ctx);
    const order = (await as(ctx.actor).post("/invoices/purchase-orders").send({
      budget_id: budget.id, number: "OC-88231", date: "2026-11-10", concept: "labor", currency: "ARS", amount: 1000000,
    })).body.data;
    const wanted = await draftInvoice(ctx, budget, { lines: [{ concept: "labor", percent: 50, purchase_order_id: order.id }] });

    const res = await as(ctx.actor).get("/invoices").query({ q: "88231" });

    expect(ids(res)).toEqual([wanted.id]);
  });

  it("encuentra por el número del comprobante, con o sin ceros", async () => {
    const ctx = await setup();
    const { budget } = await approvedBudget(ctx);
    const wanted = await draftInvoice(ctx, budget);
    await db.Invoice.update({ arca_status: "authorized", number: 4821, pos_number: 3, cae: "76123456789012" }, { where: { id: wanted.id } });
    const noise = await approvedBudget(ctx);
    await draftInvoice(ctx, noise.budget);

    expect(ids(await as(ctx.actor).get("/invoices").query({ q: "0003-00004821" }))).toEqual([wanted.id]);
    expect(ids(await as(ctx.actor).get("/invoices").query({ q: "4821" }))).toEqual([wanted.id]);
  });

  it("sin texto o en blanco no filtra, y sin coincidencias devuelve vacío", async () => {
    const ctx = await setup();
    const { budget } = await approvedBudget(ctx, { budget: { client_budget_number: "A-1" } });
    const invoice = await draftInvoice(ctx, budget);

    expect(ids(await as(ctx.actor).get("/invoices"))).toEqual([invoice.id]);
    expect(ids(await as(ctx.actor).get("/invoices").query({ q: "   " }))).toEqual([invoice.id]);
    expect((await as(ctx.actor).get("/invoices").query({ q: "no-existe-zzz" })).body.data).toEqual([]);
  });

  it("combina con los demás filtros y no trae facturas anuladas por el buscador", async () => {
    const ctx = await setup();
    const { budget, client } = await approvedBudget(ctx, { budget: { client_budget_number: "COMBO-5" } });
    const invoice = await draftInvoice(ctx, budget);
    const otherClient = await createClient();

    expect(ids(await as(ctx.actor).get("/invoices").query({ q: "COMBO", client_id: client.id }))).toEqual([invoice.id]);
    expect((await as(ctx.actor).get("/invoices").query({ q: "COMBO", client_id: otherClient.id })).body.data).toEqual([]);

    await db.Invoice.update({ status: "cancelled" }, { where: { id: invoice.id } });
    expect((await as(ctx.actor).get("/invoices").query({ q: "COMBO" })).body.data).toEqual([]);
    expect(ids(await as(ctx.actor).get("/invoices").query({ q: "COMBO", include_closed: "true" }))).toEqual([invoice.id]);
  });

  it("sin invoices_read se rechaza", async () => {
    const reader = await createActor({ permissions: [] });
    const res = await as(reader).get("/invoices").query({ q: "x" });
    expect(res.status).toBe(401);
  });
});

describe("GET /invoices/billables?q= — por el N° de presupuesto del cliente", () => {
  it("encuentra el presupuesto aprobado y expone el número en su cabecera", async () => {
    const ctx = await setup();
    const target = await approvedBudget(ctx, { budget: { client_budget_number: "BILL-6633" } });
    await approvedBudget(ctx, { budget: { client_budget_number: "BILL-0002" } });

    const res = await as(ctx.actor).get("/invoices/billables").query({ q: "6633" });

    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([target.budget.id]);
    expect(res.body.data[0].client_budget_number).toBe("BILL-6633");
  });

  it("sigue buscando por lo de siempre: nuestro número y el N° de cotización de la PC", async () => {
    const ctx = await setup();
    const withQr = await approvedBudget(ctx);
    const qr = await db.QuoteRequest.create({
      number: "PC-TEST-9001", title: "PC", client_quote_number: "COT-CLI-3377", client_id: withQr.client.id, due_date: "2030-01-01", created_by: ctx.actor.user.id,
    });
    await withQr.budget.update({ quote_request_id: qr.id });
    await approvedBudget(ctx);

    expect(ids(await as(ctx.actor).get("/invoices/billables").query({ q: withQr.budget.number }))).toEqual([withQr.budget.id]);
    expect(ids(await as(ctx.actor).get("/invoices/billables").query({ q: "3377" }))).toEqual([withQr.budget.id]);
  });
});
