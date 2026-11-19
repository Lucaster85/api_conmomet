"use strict";
// Ajustes de precio como factura nueva vinculada (PLAN_ARCA.md etapa 8, FLOWS.md §71). ARCA y R2 simulados.
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
  await db.BudgetLaborLine.create({ budget_id: budget.id, budget_item_type_id: itemType.id, quantity: 10, unit_price: 100000, estimated_total: 1000000, currency: "ARS" });
  await db.BudgetMaterialItem.create({ budget_id: budget.id, description: "Caños", quantity: 1, material_unit_id: unit.id, unit_price: 200000, total_price: 200000, currency: "ARS" });
  const pos = await db.CompanyPointOfSale.create({ number: 3, usage_description: "Obras", type: "web_service" });
  return { actor, client, budget, pos };
}

// Una factura ya emitida por ARCA (se arma como borrador y se la pasa a "autorizada": la emisión tiene su propio test).
async function authorized(ctx, lines, extra = {}) {
  const draft = (await as(ctx.actor).post("/invoices").send({
    source: "arca", cbte_tipo: 1, point_of_sale_id: ctx.pos.id, arca_concept: 1, issue_date: TODAY, currency: "ARS", iva_rate: 21,
    budget_id: ctx.budget.id, lines, ...extra,
  })).body.data;
  await db.Invoice.update({ arca_status: "authorized", number: ++invoiceNumber, cae: "76123456789012", pos_number: 3 }, { where: { id: draft.id } });
  return (await as(ctx.actor).get(`/invoices/${draft.id}`)).body.data;
}

const adjust = (ctx, original, lines, extra = {}) => as(ctx.actor).post("/invoices").send({
  source: "arca", adjusts_invoice_id: original.id, issue_date: TODAY, ...extra,
  lines: lines || original.lines.map((l) => ({ adjusts_line_id: l.id, percent: 20 })),
});
const order = (ctx, overrides = {}) =>
  as(ctx.actor).post("/invoices/purchase-orders").send({ budget_id: ctx.budget.id, number: "OC-9", date: "2026-11-10", ...overrides }).then((r) => r.body.data);
const detail = (ctx) => as(ctx.actor).get(`/invoices/billables/${ctx.budget.id}`).then((r) => r.body.data);

describe("crear un ajuste", () => {
  it("genera una factura nueva por la diferencia, vinculada a la original y con la descripción precargada", async () => {
    const ctx = await setup();
    const original = await authorized(ctx, [{ concept: "labor", percent: 100 }]);
    const res = await adjust(ctx, original, null, { adjustment_period: "Octubre 2026" });
    expect(res.status).toBe(201);
    const data = res.body.data;
    expect(data).toMatchObject({
      adjusts_invoice_id: original.id, source: "arca", arca_status: "draft", cbte_tipo: 1, currency: "ARS", client_id: ctx.client.id,
      net_amount: 200000, iva_amount: 42000, total_amount: 242000, budget_id: ctx.budget.id, kind: "invoice",
    });
    expect(data.lines[0]).toMatchObject({
      concept: "adjustment", adjustment_type: "ipc_indec", adjustment_percent: 20, adjustment_base_amount: 1000000, net_amount: 200000,
      adjusts_line_id: original.lines[0].id, budget_id: ctx.budget.id,
    });
    expect(data.lines[0].description).toMatch(/^Ajuste IPC INDEC \(Octubre 2026\) s\/ Factura A 0003-0000000\d – PRES-TEST-\d+$/);
    expect(data.adjustedInvoice.id).toBe(original.id);
  });

  it("acepta el monto en lugar del porcentaje y recalcula el porcentaje", async () => {
    const ctx = await setup();
    const original = await authorized(ctx, [{ concept: "labor", percent: 50 }]);
    const res = await adjust(ctx, original, [{ adjusts_line_id: original.lines[0].id, net_amount: 50000, adjustment_type: "uocra", description: "Ajuste UOCRA septiembre" }]);
    expect(res.status).toBe(201);
    expect(res.body.data.lines[0]).toMatchObject({ net_amount: 50000, adjustment_percent: 10, adjustment_type: "uocra", description: "Ajuste UOCRA septiembre" });
  });

  it("no descuenta saldo del presupuesto: solo suma al total ajustado cuando se emite", async () => {
    const ctx = await setup();
    const original = await authorized(ctx, [{ concept: "labor", percent: 100 }]);
    const created = (await adjust(ctx, original)).body.data;
    let d = await detail(ctx);
    expect(d.billing.billed.ARS.labor).toBe(1000000);
    expect(d.billing.balances.ARS.labor).toBe(0);
    expect(d.billing.adjustments.ARS).toBe(0); // el borrador todavía no es una factura
    await db.Invoice.update({ arca_status: "authorized", number: ++invoiceNumber, cae: "76123456789013" }, { where: { id: created.id } });
    d = await detail(ctx);
    expect(d.billing.billed.ARS.labor).toBe(1000000);
    expect(d.billing.adjustments.ARS).toBe(200000);
    expect(d.billing.pending_invoices_count).toBe(2); // el ajuste también se cobra
  });

  it("la original muestra su ajuste vigente y el ajuste a qué factura corresponde", async () => {
    const ctx = await setup();
    const original = await authorized(ctx, [{ concept: "labor", percent: 100 }]);
    const created = (await adjust(ctx, original)).body.data;
    const got = (await as(ctx.actor).get(`/invoices/${original.id}`)).body.data;
    expect(got.adjustment).toMatchObject({ id: created.id, total_amount: 242000 });
    const list = (await as(ctx.actor).get("/invoices")).body.data;
    expect(list.find((i) => i.id === original.id).adjustment.id).toBe(created.id);
    expect(list.find((i) => i.id === created.id).adjustedInvoice.id).toBe(original.id);
  });

  it("solo sobre una factura emitida por ARCA, no anulada", async () => {
    const ctx = await setup();
    const draft = (await as(ctx.actor).post("/invoices").send({
      source: "arca", cbte_tipo: 1, point_of_sale_id: ctx.pos.id, arca_concept: 1, issue_date: TODAY, currency: "ARS", iva_rate: 21,
      budget_id: ctx.budget.id, lines: [{ concept: "labor", percent: 10 }],
    })).body.data;
    expect((await adjust(ctx, draft, [{ adjusts_line_id: draft.lines[0].id, percent: 10 }])).status).toBe(409);

    const original = await authorized(ctx, [{ concept: "materials", percent: 10 }]);
    await db.Invoice.update({ status: "cancelled" }, { where: { id: original.id } });
    expect((await adjust(ctx, original)).status).toBe(409);
  });

  it("no se puede ajustar una factura cargada a mano", async () => {
    const ctx = await setup();
    const manual = (await as(ctx.actor).post("/invoices").send({
      voucher_type: "A", pos_number: 1, number: 77, issue_date: TODAY, currency: "ARS", iva_rate: 21, budget_id: ctx.budget.id, lines: [{ concept: "labor", percent: 10 }],
    })).body.data;
    const res = await adjust(ctx, manual, [{ adjusts_line_id: manual.lines[0].id, percent: 10 }]);
    expect(res.status).toBe(409);
    const asManual = await as(ctx.actor).post("/invoices").send({
      voucher_type: "A", pos_number: 1, number: 78, issue_date: TODAY, currency: "ARS", iva_rate: 21, adjusts_invoice_id: manual.id, lines: [],
    });
    expect(asManual.status).toBe(400);
  });

  it.each([
    ["sin fecha", { issue_date: "" }, /fecha/],
    ["sin líneas", { lines: [] }, /al menos una línea/],
    ["con una línea ajena", { lines: [{ adjusts_line_id: 999999, percent: 10 }] }, /no pertenece/],
    ["sin porcentaje ni monto", { lines: "SIN_MONTO" }, /porcentaje o el monto/],
    ["con un tipo inválido", { lines: "TIPO" }, /tipo de ajuste/],
    ["de más del 1000%", { lines: "ENORME" }, /1000%/],
  ])("rechaza un ajuste %s", async (_label, overrides, message) => {
    const ctx = await setup();
    const original = await authorized(ctx, [{ concept: "labor", percent: 100 }]);
    const lineId = original.lines[0].id;
    const lines = overrides.lines === "SIN_MONTO" ? [{ adjusts_line_id: lineId }]
      : overrides.lines === "TIPO" ? [{ adjusts_line_id: lineId, percent: 5, adjustment_type: "otro" }]
      : overrides.lines === "ENORME" ? [{ adjusts_line_id: lineId, percent: 5000 }]
      : overrides.lines;
    const res = await adjust(ctx, original, lines, { ...overrides, lines });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });

  it("la base de la línea es lo que queda después de las notas de crédito", async () => {
    const ctx = await setup();
    const original = await authorized(ctx, [{ concept: "labor", percent: 100 }]);
    await as(ctx.actor).post("/invoices").send({
      source: "arca", kind: "credit_note", associated_invoice_id: original.id, issue_date: TODAY, notes: "Devolución",
      lines: [{ credits_line_id: original.lines[0].id, percent: 50 }],
    });
    const res = await adjust(ctx, original, [{ adjusts_line_id: original.lines[0].id, percent: 10 }]);
    expect(res.body.data.lines[0]).toMatchObject({ adjustment_base_amount: 500000, net_amount: 50000 });
  });
});

describe("OC y ajuste", () => {
  it("una línea de una OC que no admite ajuste no se ajusta", async () => {
    const ctx = await setup();
    const oc = await order(ctx, { allows_adjustment: false });
    const original = await authorized(ctx, [{ concept: "labor", percent: 50, purchase_order_id: oc.id }]);
    const res = await adjust(ctx, original);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no admite ajuste/);
  });

  it("una OC que lo admite sí, con su índice por defecto, y el ajuste hereda OC y presupuesto", async () => {
    const ctx = await setup();
    const oc = await order(ctx, { allows_adjustment: true, adjustment_type: "uocra" });
    const original = await authorized(ctx, [{ concept: "labor", percent: 50, purchase_order_id: oc.id }]);
    const res = await adjust(ctx, original);
    expect(res.status).toBe(201);
    expect(res.body.data.lines[0]).toMatchObject({ adjustment_type: "uocra", purchase_order_id: oc.id, budget_id: ctx.budget.id });
    expect(res.body.data.lines[0].description).toContain(`OC ${oc.number}`);
    // El ajuste no gasta saldo de la OC.
    expect((await detail(ctx)).purchase_orders[0].billed).toBe(500000);
  });

  it("sin OC se permite ajustar", async () => {
    const ctx = await setup();
    const original = await authorized(ctx, [{ concept: "labor", percent: 10 }]);
    expect((await adjust(ctx, original)).status).toBe(201);
  });
});

describe("un solo ajuste vigente por factura", () => {
  it("un segundo ajuste se rechaza mientras el primero esté vigente, y se permite si se descarta", async () => {
    const ctx = await setup();
    const original = await authorized(ctx, [{ concept: "labor", percent: 100 }]);
    const first = (await adjust(ctx, original)).body.data;
    const second = await adjust(ctx, original);
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/ajuste vigente/);
    expect((await as(ctx.actor).put(`/invoices/${first.id}/discard`).send({})).status).toBe(200);
    expect((await adjust(ctx, original)).status).toBe(201);
  });

  it("dos ajustes simultáneos: uno se crea y el otro se rechaza", async () => {
    const ctx = await setup();
    const original = await authorized(ctx, [{ concept: "labor", percent: 100 }]);
    const results = await Promise.all([adjust(ctx, original), adjust(ctx, original)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await db.Invoice.count({ where: { adjusts_invoice_id: original.id } })).toBe(1);
  });

  it("el índice único de la base es la segunda barrera", async () => {
    const ctx = await setup();
    const original = await authorized(ctx, [{ concept: "labor", percent: 100 }]);
    await adjust(ctx, original);
    const first = await db.Invoice.findOne({ where: { adjusts_invoice_id: original.id } });
    await expect(db.Invoice.create({ ...first.toJSON(), id: undefined, created_at: undefined, updated_at: undefined })).rejects.toThrow();
  });

  it("una factura de ajuste no se ajusta", async () => {
    const ctx = await setup();
    const original = await authorized(ctx, [{ concept: "labor", percent: 100 }]);
    const created = (await adjust(ctx, original)).body.data;
    await db.Invoice.update({ arca_status: "authorized", number: ++invoiceNumber, cae: "76123456789013" }, { where: { id: created.id } });
    const emitted = (await as(ctx.actor).get(`/invoices/${created.id}`)).body.data;
    const res = await adjust(ctx, emitted, [{ adjusts_line_id: emitted.lines[0].id, percent: 5 }]);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/no se puede volver a ajustar/);
  });
});

describe("editar un borrador de ajuste", () => {
  it("se corrige sin chocar consigo mismo y sigue siendo el ajuste de la original", async () => {
    const ctx = await setup();
    const original = await authorized(ctx, [{ concept: "labor", percent: 100 }]);
    const created = (await adjust(ctx, original)).body.data;
    const res = await as(ctx.actor).put(`/invoices/${created.id}`).send({
      issue_date: TODAY, lines: [{ adjusts_line_id: original.lines[0].id, percent: 30 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ adjusts_invoice_id: original.id, net_amount: 300000 });
    expect(res.body.data.lines).toHaveLength(1);
  });
});

describe("anular una factura con ajuste", () => {
  async function adjusted() {
    const ctx = await setup();
    const original = await authorized(ctx, [{ concept: "labor", percent: 100 }]);
    const adjustment = (await adjust(ctx, original)).body.data;
    await db.Invoice.update({ arca_status: "authorized", number: ++invoiceNumber, cae: "76123456789013" }, { where: { id: adjustment.id } });
    return { ctx, original, adjustment };
  }
  const credit = (ctx, invoice, percent) => as(ctx.actor).post("/invoices").send({
    source: "arca", kind: "credit_note", associated_invoice_id: invoice.id, issue_date: TODAY, notes: "Anulación",
    lines: invoice.lines.map((l) => ({ credits_line_id: l.id, percent })),
  });

  it("no se anula del todo una factura con un ajuste vigente (B9)", async () => {
    const { ctx, original } = await adjusted();
    const res = await credit(ctx, original, 100);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/ajuste vigente/);
  });

  it("una nota de crédito parcial sí se puede", async () => {
    const { ctx, original } = await adjusted();
    expect((await credit(ctx, original, 40)).status).toBe(201);
  });

  it("una vez anulado el ajuste, se puede anular la original", async () => {
    const { ctx, original, adjustment } = await adjusted();
    const emitted = (await as(ctx.actor).get(`/invoices/${adjustment.id}`)).body.data;
    const note = await credit(ctx, emitted, 100);
    expect(note.status).toBe(201);
    expect(note.body.data.lines[0]).toMatchObject({ concept: "adjustment", budget_id: ctx.budget.id });
    await db.Invoice.update({ status: "cancelled" }, { where: { id: adjustment.id } }); // lo que hace la emisión de la NC total
    expect((await credit(ctx, original, 100)).status).toBe(201);
  });
});

describe("notas de débito en el detalle del presupuesto", () => {
  it("una nota de débito aparece en el presupuesto de su factura y su cobro pendiente cuenta", async () => {
    const ctx = await setup();
    const original = await authorized(ctx, [{ concept: "labor", percent: 50 }]);
    const note = (await as(ctx.actor).post("/invoices").send({
      source: "arca", kind: "debit_note", associated_invoice_id: original.id, issue_date: TODAY, lines: [{ description: "Intereses", net_amount: 1000 }],
    })).body.data;
    expect(note.lines[0].budget_id).toBe(ctx.budget.id);
    await db.Invoice.update({ arca_status: "authorized", number: ++invoiceNumber, cae: "76123456789013" }, { where: { id: note.id } });
    const d = await detail(ctx);
    expect(d.invoices.map((i) => i.id)).toContain(note.id);
    expect(d.billing.billed.ARS.labor).toBe(500000); // una nota de débito no toca el saldo
    expect(d.billing.pending_invoices_count).toBe(2);
  });
});
