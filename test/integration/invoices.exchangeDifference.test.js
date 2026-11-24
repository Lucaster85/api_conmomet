"use strict";
// Notas por diferencia de cambio sobre facturas en dólares (PLAN_ARCA.md etapa 10, FLOWS.md §73). ARCA y R2 simulados.
jest.mock("../../helpers/r2Storage", () => ({
  ...jest.requireActual("../../helpers/r2Storage"),
  uploadToR2: jest.fn(async (file, folder) => `https://files.test/${folder}/${file.originalname}`),
  deleteFromR2: jest.fn(async () => {}),
}));

const db = require("../../models");
const { todayInArgentina } = require("../../helpers/argentinaDate");
const { createActor, as } = require("../helpers/auth");
const { createClient, createBudget, createBudgetItemType, createMaterialUnit } = require("../factories/budget");

const TODAY = todayInArgentina();
const PERMS = ["invoices_read", "invoices_write", "invoices_update", "invoices_delete", "invoices_correct"];
let invoiceNumber = 0;

async function setup() {
  const actor = await createActor({ permissions: PERMS });
  const client = await createClient();
  const budget = await createBudget({ clientId: client.id, createdBy: actor.user.id, status: "approved", approved_at: new Date() });
  const itemType = await createBudgetItemType();
  const unit = await createMaterialUnit();
  await db.BudgetLaborLine.create({ budget_id: budget.id, budget_item_type_id: itemType.id, quantity: 10, unit_price: 100, estimated_total: 1000, currency: "USD" });
  await db.BudgetMaterialItem.create({ budget_id: budget.id, description: "Caños", quantity: 1, material_unit_id: unit.id, unit_price: 200, total_price: 200, currency: "USD" });
  const pos = await db.CompanyPointOfSale.create({ number: 3, usage_description: "Obras", type: "web_service" });
  return { actor, client, budget, pos };
}

// Factura en USD emitida por ARCA (cotización 1000): 1000 USD netos de mano de obra.
async function usdInvoice(ctx, { percent = 100, currency = "USD", rate = 1000 } = {}) {
  const draft = (await as(ctx.actor).post("/invoices").send({
    source: "arca", cbte_tipo: 1, point_of_sale_id: ctx.pos.id, arca_concept: 1, issue_date: TODAY, currency, iva_rate: 21,
    ...(currency === "USD" ? { exchange_rate: rate, same_currency_payment: true } : {}),
    budget_id: ctx.budget.id, lines: [{ concept: "labor", percent }],
  })).body.data;
  await db.Invoice.update({ arca_status: "authorized", number: ++invoiceNumber, cae: "76123456789012", pos_number: 3 }, { where: { id: draft.id } });
  return (await as(ctx.actor).get(`/invoices/${draft.id}`)).body.data;
}

const diffNote = (ctx, original, extra = {}) => as(ctx.actor).post("/invoices").send({
  source: "arca", exchange_difference: true, associated_invoice_id: original.id, issue_date: TODAY, new_exchange_rate: 1100, ...extra,
});

describe("diferencia de cambio", () => {
  it("si el dólar subió, una nota de débito en pesos por la diferencia, con el IVA de la factura", async () => {
    const ctx = await setup();
    const original = await usdInvoice(ctx);
    const res = await diffNote(ctx, original);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      kind: "debit_note", cbte_tipo: 2, currency: "ARS", exchange_rate: null, exchange_difference: true, associated_invoice_id: original.id,
      net_amount: 100000, iva_amount: 21000, total_amount: 121000, total_amount_ars: 121000, arca_status: "draft", budget_id: ctx.budget.id,
      exchange_diff_base_rate: 1000, exchange_diff_new_rate: 1100, exchange_diff_base_usd: 1000,
    });
    expect(res.body.data.lines[0]).toMatchObject({ concept: "other", net_amount: 100000, credits_line_id: null });
    expect(res.body.data.lines[0].description).toMatch(/^Diferencia de cambio s\/ Factura A 0003-0000000\d: USD 1\.000,00 x \(TC 1\.100,00 - TC 1\.000,00\)$/);
  });

  it("si el dólar bajó, una nota de crédito", async () => {
    const ctx = await setup();
    const original = await usdInvoice(ctx);
    const res = await diffNote(ctx, original, { new_exchange_rate: 950 });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ kind: "credit_note", cbte_tipo: 3, currency: "ARS", net_amount: 50000, total_amount: 60500 });
  });

  it("se puede calcular sobre una parte del neto en dólares", async () => {
    const ctx = await setup();
    const original = await usdInvoice(ctx);
    expect((await diffNote(ctx, original, { base_usd: 400 })).body.data.net_amount).toBe(40000);
  });

  it("el neto en dólares no puede superar lo que queda de la factura (descontando las notas de crédito)", async () => {
    const ctx = await setup();
    const original = await usdInvoice(ctx);
    await as(ctx.actor).post("/invoices").send({
      source: "arca", kind: "credit_note", associated_invoice_id: original.id, issue_date: TODAY, notes: "Devolución",
      lines: [{ credits_line_id: original.lines[0].id, percent: 50 }],
    });
    const over = await diffNote(ctx, original, { base_usd: 600 });
    expect(over.status).toBe(400);
    expect(over.body.error).toMatch(/no puede superar/);
    expect((await diffNote(ctx, original)).body.data.exchange_diff_base_usd).toBe(500);
  });

  it.each([
    ["sin cotización nueva", { new_exchange_rate: "" }, /cotización nueva/],
    ["con la misma cotización", { new_exchange_rate: 1000 }, /no hay diferencia/],
    ["sin fecha", { issue_date: "" }, /fecha/],
    ["con base en cero", { base_usd: 0 }, /mayor a cero/],
  ])("rechaza una nota %s", async (_label, overrides, message) => {
    const ctx = await setup();
    const original = await usdInvoice(ctx);
    const res = await diffNote(ctx, original, overrides);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });

  it("solo sobre facturas en dólares emitidas por ARCA", async () => {
    const ctx = await setup();
    // Una factura en pesos (presupuesto con mano de obra en ARS).
    const arsBudget = await createBudget({ clientId: ctx.client.id, createdBy: ctx.actor.user.id, status: "approved", approved_at: new Date() });
    await db.BudgetLaborLine.create({ budget_id: arsBudget.id, budget_item_type_id: (await createBudgetItemType()).id, quantity: 1, unit_price: 5000, estimated_total: 5000, currency: "ARS" });
    const arsDraft = (await as(ctx.actor).post("/invoices").send({
      source: "arca", cbte_tipo: 1, point_of_sale_id: ctx.pos.id, arca_concept: 1, issue_date: TODAY, currency: "ARS", iva_rate: 21,
      budget_id: arsBudget.id, lines: [{ concept: "labor", percent: 100 }],
    })).body.data;
    await db.Invoice.update({ arca_status: "authorized", number: ++invoiceNumber, cae: "76123456789012", pos_number: 3 }, { where: { id: arsDraft.id } });
    expect((await diffNote(ctx, arsDraft)).status).toBe(409);
    const draft = (await as(ctx.actor).post("/invoices").send({
      source: "arca", cbte_tipo: 1, point_of_sale_id: ctx.pos.id, arca_concept: 1, issue_date: TODAY, currency: "USD", exchange_rate: 1000, same_currency_payment: true,
      budget_id: ctx.budget.id, lines: [{ concept: "materials", percent: 10 }],
    })).body.data;
    expect((await diffNote(ctx, draft)).status).toBe(409);
  });

  it("una sola nota vigente por factura; si se descarta se puede hacer otra", async () => {
    const ctx = await setup();
    const original = await usdInvoice(ctx);
    const first = (await diffNote(ctx, original)).body.data;
    const second = await diffNote(ctx, original, { new_exchange_rate: 1200 });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/vigente/);
    await as(ctx.actor).put(`/invoices/${first.id}/discard`).send({});
    expect((await diffNote(ctx, original, { new_exchange_rate: 1200 })).status).toBe(201);
  });

  it("editar el borrador recalcula y puede cambiar de débito a crédito", async () => {
    const ctx = await setup();
    const original = await usdInvoice(ctx);
    const note = (await diffNote(ctx, original)).body.data;
    expect(note.kind).toBe("debit_note");
    const res = await as(ctx.actor).put(`/invoices/${note.id}`).send({ source: "arca", exchange_difference: true, issue_date: TODAY, new_exchange_rate: 900 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ kind: "credit_note", cbte_tipo: 3, net_amount: 100000, exchange_diff_new_rate: 900 });
  });

  it("no toca los saldos ni lo acreditado o por cobrar de la factura en dólares", async () => {
    const ctx = await setup();
    const original = await usdInvoice(ctx);
    const note = (await diffNote(ctx, original, { new_exchange_rate: 950 })).body.data;
    await db.Invoice.update({ arca_status: "authorized", number: ++invoiceNumber, cae: "76123456789013" }, { where: { id: note.id } });
    const d = (await as(ctx.actor).get(`/invoices/billables/${ctx.budget.id}`)).body.data;
    expect(d.billing.billed.USD.labor).toBe(1000);
    expect(d.billing.billed.ARS).toEqual({ materials: 0, labor: 0 });
    // La NC en pesos no baja lo que falta cobrar de la factura en dólares.
    expect(d.billing.pending_amount.USD).toBe(1210);
    const got = (await as(ctx.actor).get(`/invoices/${original.id}`)).body.data;
    expect(got.credited_total).toBe(0);
  });

  it("una nota de débito por diferencia de cambio emitida se cobra como cualquier nota de débito, en pesos", async () => {
    const ctx = await setup();
    const original = await usdInvoice(ctx);
    const note = (await diffNote(ctx, original)).body.data;
    await db.Invoice.update({ arca_status: "authorized", number: ++invoiceNumber, cae: "76123456789013" }, { where: { id: note.id } });
    const d = (await as(ctx.actor).get(`/invoices/billables/${ctx.budget.id}`)).body.data;
    expect(d.billing.pending_amount.ARS).toBe(121000);
  });

  it("pide los permisos de las facturas", async () => {
    const ctx = await setup();
    const original = await usdInvoice(ctx);
    const reader = await createActor({ permissions: ["invoices_read"] });
    expect((await as(reader).post("/invoices").send({
      source: "arca", exchange_difference: true, associated_invoice_id: original.id, issue_date: TODAY, new_exchange_rate: 1100,
    })).status).toBe(401);
  });
});

describe("el formulario del frontend (multipart, todo como texto)", () => {
  it("una nota por diferencia de cambio se crea igual que desde el navegador", async () => {
    const ctx = await setup();
    const original = await usdInvoice(ctx);
    const res = await as(ctx.actor).post("/invoices")
      .field("voucher_type", "A").field("source", "arca").field("exchange_difference", "true").field("associated_invoice_id", String(original.id))
      .field("issue_date", TODAY).field("currency", "ARS").field("point_of_sale_id", String(ctx.pos.id)).field("new_exchange_rate", "1100").field("base_usd", "400")
      .field("lines", "[]");
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ kind: "debit_note", exchange_difference: true, net_amount: 40000, exchange_diff_base_usd: 400 });
  });
});

describe("la cotización del dólar lleva a lo sumo 2 decimales", () => {
  it("una factura en dólares guarda la cotización redondeada a 2 decimales y calcula el total en pesos con esa", async () => {
    const ctx = await setup();
    const res = await as(ctx.actor).post("/invoices").send({
      source: "arca", cbte_tipo: 1, point_of_sale_id: ctx.pos.id, arca_concept: 1, issue_date: TODAY, currency: "USD", iva_rate: 21,
      exchange_rate: 1497.5324, same_currency_payment: true, budget_id: ctx.budget.id, lines: [{ concept: "labor", percent: 10 }],
    });
    expect(res.status).toBe(201);
    // 10% de USD 1.000 = 100 + IVA 21% = 121 USD; a 1.497,53
    expect(res.body.data).toMatchObject({ exchange_rate: 1497.53, total_amount: 121, total_amount_ars: 181201.13 });
  });

  it("la cotización nueva de una nota por diferencia de cambio también se redondea a 2 decimales", async () => {
    const ctx = await setup();
    const original = await usdInvoice(ctx);
    const res = await diffNote(ctx, original, { new_exchange_rate: 1100.456 });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ exchange_diff_new_rate: 1100.46, net_amount: 100460 });
  });

  it("una diferencia menor a un centavo por dólar no alcanza para hacer la nota", async () => {
    const ctx = await setup();
    const original = await usdInvoice(ctx);
    const res = await diffNote(ctx, original, { new_exchange_rate: 1000.004 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no hay diferencia/);
  });
});
