"use strict";
// Notas de crédito y de débito por ARCA (PLAN_ARCA.md etapa 5, FLOWS.md §68). ARCA y R2 simulados.
jest.mock("../../services/arca/wsfe", () => ({
  dummy: jest.fn(), getPointsOfSale: jest.fn(), getLastAuthorized: jest.fn(), getVoucher: jest.fn(), requestCae: jest.fn(),
  getExchangeRate: jest.fn(),
}));
jest.mock("../../helpers/r2Storage", () => ({
  ...jest.requireActual("../../helpers/r2Storage"),
  uploadToR2: jest.fn(async (file, folder) => `https://files.test/${folder}/${file.originalname}`),
  deleteFromR2: jest.fn(async () => {}),
}));

const db = require("../../models");
const wsfe = require("../../services/arca/wsfe");
const { ArcaError } = require("../../services/arca/errors");
const { todayInArgentina } = require("../../helpers/argentinaDate");
const { createActor, as } = require("../helpers/auth");
const { createClient, createBudget, createBudgetItemType, createMaterialUnit } = require("../factories/budget");

const COMPANY_CUIT = "20123456786";
const CLIENT_CUIT = "30716396653";
const VALID_CBU = "0170099220000067797370";
const TODAY = todayInArgentina();
const IN_30_DAYS = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

let savedEnv;
beforeAll(() => { savedEnv = { env: process.env.ARCA_ENV, cuit: process.env.ARCA_CUIT }; });
afterAll(() => {
  for (const [key, value] of [["ARCA_ENV", savedEnv.env], ["ARCA_CUIT", savedEnv.cuit]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

const counters = {};
const approved = (number) => ({
  FeCabResp: { Resultado: "A" },
  FeDetResp: { FECAEDetResponse: [{ Resultado: "A", CbteDesde: number, CAE: "76123456789012", CAEFchVto: "20261126" }] },
});

beforeEach(async () => {
  jest.clearAllMocks();
  for (const key of Object.keys(counters)) delete counters[key];
  process.env.ARCA_ENV = "homologacion";
  process.env.ARCA_CUIT = COMPANY_CUIT;
  await db.CompanyProfile.update(
    { legal_name: "CONMOMET S.A", cuit: COMPANY_CUIT, vat_condition: "responsable_inscripto", fce_transfer_option: "SCA", address_street: "578 1682", address_locality: "Quequén", address_province: "Buenos Aires" },
    { where: { id: 1 } }
  );
  wsfe.getLastAuthorized.mockImplementation(async (pos, tipo) => counters[tipo] || 0);
  wsfe.getVoucher.mockResolvedValue(null);
  wsfe.requestCae.mockImplementation(async (req) => {
    const tipo = req.FeCAEReq.FeCabReq.CbteTipo;
    const number = req.FeCAEReq.FeDetReq.FECAEDetRequest[0].CbteDesde;
    counters[tipo] = number;
    return approved(number);
  });
});

async function setup(permissions = ["invoices_read", "invoices_write", "invoices_update", "invoices_emit"]) {
  const actor = await createActor({ permissions });
  const client = await createClient({ cuit: CLIENT_CUIT, tax_condition: "responsable_inscripto" });
  const budget = await createBudget({ clientId: client.id, createdBy: actor.user.id, status: "approved", approved_at: new Date() });
  const itemType = await createBudgetItemType();
  const unit = await createMaterialUnit();
  await db.BudgetLaborLine.create({ budget_id: budget.id, budget_item_type_id: itemType.id, quantity: 10, unit_price: 10000, estimated_total: 100000 });
  await db.BudgetMaterialItem.create({ budget_id: budget.id, description: "Caños", quantity: 1, material_unit_id: unit.id, unit_price: 20000, total_price: 20000 });
  const pos = await db.CompanyPointOfSale.create({ number: 3, usage_description: "Obras", type: "web_service" });
  const account = await db.CompanyBankAccount.create({ bank_name: "Banco X", cbu: VALID_CBU, alias: "CONMOMET.COBROS", is_default: true });
  return { actor, client, budget, pos, account };
}

const emit = (ctx, id) => as(ctx.actor).post(`/invoices/${id}/emit`).send({});

// Factura emitida: mano de obra 50% (neto 50.000) y materiales 100% (neto 20.000).
async function issuedInvoice(ctx, { fce = false, lines } = {}) {
  const res = await as(ctx.actor).post("/invoices").send({
    source: "arca", cbte_tipo: fce ? 201 : 1, budget_id: ctx.budget.id, point_of_sale_id: ctx.pos.id, issue_date: TODAY, due_date: IN_30_DAYS, currency: "ARS",
    arca_concept: 1, iva_rate: 21, lines: lines || [{ concept: "labor", percent: 50 }, { concept: "materials", percent: 100 }],
  });
  expect(res.status).toBe(201);
  const issued = await emit(ctx, res.body.data.id);
  expect(issued.status).toBe(200);
  return (await as(ctx.actor).get(`/invoices/${issued.body.data.id}`)).body.data;
}
const lineOf = (invoice, concept) => invoice.lines.find((l) => l.concept === concept);
const noteBody = (original, over = {}) => ({
  source: "arca", kind: "credit_note", associated_invoice_id: original.id, issue_date: TODAY, notes: "Devolución de materiales",
  lines: [{ credits_line_id: lineOf(original, "labor").id, percent: 30 }], ...over,
});
const createNote = async (ctx, original, over) => {
  const res = await as(ctx.actor).post("/invoices").send(noteBody(original, over));
  expect(res.status).toBe(201);
  return res.body.data;
};
const detail = async (ctx) => (await as(ctx.actor).get(`/invoices/billables/${ctx.budget.id}`)).body.data;

describe("borrador de nota de crédito", () => {
  it("hereda de la factura: tipo 3, cliente, moneda, IVA, punto de venta y comprobante asociado", async () => {
    const ctx = await setup();
    const original = await issuedInvoice(ctx);
    const note = await createNote(ctx, original);
    expect(note).toMatchObject({
      kind: "credit_note", cbte_tipo: 3, source: "arca", arca_status: "draft", number: null, status: "pending", associated_invoice_id: original.id,
      client_id: original.client_id, budget_id: ctx.budget.id, currency: "ARS", iva_rate: 21, pos_number: 3, point_of_sale_id: ctx.pos.id,
      recipient_doc_number: CLIENT_CUIT, notes: "Devolución de materiales",
    });
    expect(note.associatedInvoice).toMatchObject({ id: original.id, cbte_tipo: 1, pos_number: 3, number: original.number });
  });

  it("acredita por porcentaje o por monto, sobre la línea de la factura original", async () => {
    const ctx = await setup();
    const original = await issuedInvoice(ctx);
    const byPercent = await createNote(ctx, original);
    expect(byPercent.lines[0]).toMatchObject({ concept: "labor", credits_line_id: lineOf(original, "labor").id, net_amount: 15000, percent: 30 });
    expect(byPercent).toMatchObject({ net_amount: 15000, iva_amount: 3150, total_amount: 18150 });

    const byAmount = await createNote(ctx, original, { lines: [{ credits_line_id: lineOf(original, "labor").id, net_amount: 5000 }] });
    expect(byAmount.lines[0]).toMatchObject({ net_amount: 5000, percent: 10 });
  });

  it("un borrador NO libera saldo del presupuesto (solo lo libera una nota emitida)", async () => {
    const ctx = await setup();
    const original = await issuedInvoice(ctx);
    const before = (await detail(ctx)).billing.balances.ARS.labor;
    await createNote(ctx, original);
    expect((await detail(ctx)).billing.balances.ARS.labor).toBe(before);
  });

  it("no deja acreditar más de lo que queda de la línea: los borradores también cuentan", async () => {
    const ctx = await setup();
    const original = await issuedInvoice(ctx);
    await createNote(ctx, original, { lines: [{ credits_line_id: lineOf(original, "labor").id, percent: 70 }] });
    const res = await as(ctx.actor).post("/invoices").send(noteBody(original, { lines: [{ credits_line_id: lineOf(original, "labor").id, percent: 40 }] }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/supera lo que queda por acreditar/);
    // Lo que queda (30%) sí entra.
    expect((await as(ctx.actor).post("/invoices").send(noteBody(original, { lines: [{ credits_line_id: lineOf(original, "labor").id, percent: 30 }] }))).status).toBe(201);
  });

  it("una línea acreditada por completo no se puede volver a acreditar", async () => {
    const ctx = await setup();
    const original = await issuedInvoice(ctx);
    await createNote(ctx, original, { lines: [{ credits_line_id: lineOf(original, "labor").id, percent: 100 }] });
    const res = await as(ctx.actor).post("/invoices").send(noteBody(original, { lines: [{ credits_line_id: lineOf(original, "labor").id, percent: 1 }] }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ya está acreditado por completo/);
  });

  it("una nota descartada devuelve lo que reservaba", async () => {
    const ctx = await setup();
    const original = await issuedInvoice(ctx);
    const full = await createNote(ctx, original, { lines: [{ credits_line_id: lineOf(original, "labor").id, percent: 100 }] });
    expect((await as(ctx.actor).put(`/invoices/${full.id}/discard`).send({})).status).toBe(200);
    expect((await as(ctx.actor).post("/invoices").send(noteBody(original, { lines: [{ credits_line_id: lineOf(original, "labor").id, percent: 100 }] }))).status).toBe(201);
  });

  it("dos notas simultáneas no pueden acreditar entre las dos más que la factura", async () => {
    const ctx = await setup();
    const original = await issuedInvoice(ctx);
    const body = noteBody(original, { lines: [{ credits_line_id: lineOf(original, "labor").id, percent: 60 }] });
    const [a, b] = await Promise.all([as(ctx.actor).post("/invoices").send(body), as(ctx.actor).post("/invoices").send(body)]);
    expect([a.status, b.status].sort()).toEqual([201, 400]);
  });

  it("exige motivo, fecha, líneas válidas y que la línea sea de la factura original", async () => {
    const ctx = await setup();
    const original = await issuedInvoice(ctx);
    const other = await issuedInvoice(ctx, { lines: [{ concept: "labor", percent: 10 }] });
    const post = (over) => as(ctx.actor).post("/invoices").send(noteBody(original, over));
    expect((await post({ notes: "  " })).body.error).toMatch(/motivo/);
    expect((await post({ issue_date: null })).body.error).toMatch(/fecha/);
    expect((await post({ lines: [] })).body.error).toMatch(/qué se acredita/);
    expect((await post({ lines: [{ credits_line_id: 999999, percent: 10 }] })).body.error).toMatch(/no pertenece/);
    expect((await post({ lines: [{ credits_line_id: lineOf(other, "labor").id, percent: 10 }] })).body.error).toMatch(/no pertenece/);
    expect((await post({ lines: [{ credits_line_id: lineOf(original, "labor").id }] })).body.error).toMatch(/porcentaje o el monto/);
    expect((await post({ lines: [{ credits_line_id: lineOf(original, "labor").id, percent: 10 }, { credits_line_id: lineOf(original, "labor").id, percent: 10 }] })).body.error).toMatch(/repetida/);
  });

  it("solo se hacen notas sobre facturas emitidas en ARCA, no anuladas y que no sean notas", async () => {
    const ctx = await setup();
    const draft = (await as(ctx.actor).post("/invoices").send({
      source: "arca", budget_id: ctx.budget.id, point_of_sale_id: ctx.pos.id, issue_date: TODAY, currency: "ARS", arca_concept: 1, iva_rate: 21, lines: [{ concept: "labor", percent: 10 }],
    })).body.data;
    const original = await issuedInvoice(ctx, { lines: [{ concept: "labor", percent: 20 }] });
    const post = (body) => as(ctx.actor).post("/invoices").send(body);

    expect((await post({ ...noteBody(original), associated_invoice_id: draft.id })).status).toBe(409);

    const manual = await post({ voucher_type: "A", pos_number: 2, number: 10, issue_date: TODAY, currency: "ARS", budget_id: ctx.budget.id, iva_rate: 21, lines: [{ concept: "labor", percent: 5 }] });
    expect((await post({ ...noteBody(original), associated_invoice_id: manual.body.data.id })).status).toBe(409);

    const note = await createNote(ctx, original);
    expect((await post({ ...noteBody(original), associated_invoice_id: note.id })).status).toBe(409);

    await db.Invoice.update({ status: "cancelled" }, { where: { id: original.id } });
    expect((await post(noteBody(original))).status).toBe(409);
    expect((await post({ ...noteBody(original), associated_invoice_id: 999999 })).status).toBe(404);
  });

  it("se puede editar el borrador, y no cuenta contra sí mismo", async () => {
    const ctx = await setup();
    const original = await issuedInvoice(ctx);
    const note = await createNote(ctx, original, { lines: [{ credits_line_id: lineOf(original, "labor").id, percent: 100 }] });
    const res = await as(ctx.actor).put(`/invoices/${note.id}`).send(noteBody(original, { notes: "Corrección", lines: [{ credits_line_id: lineOf(original, "labor").id, percent: 90 }] }));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ net_amount: 45000, notes: "Corrección", kind: "credit_note", associated_invoice_id: original.id });
    expect(res.body.data.lines).toHaveLength(1);
  });

  it("necesita invoices_write", async () => {
    const ctx = await setup();
    const original = await issuedInvoice(ctx);
    const readOnly = await createActor({ permissions: ["invoices_read"] });
    expect((await as(readOnly).post("/invoices").send(noteBody(original))).status).toBe(401);
  });
});

describe("borrador de nota de débito", () => {
  const debitBody = (original, over = {}) => ({
    source: "arca", kind: "debit_note", associated_invoice_id: original.id, issue_date: TODAY, notes: "Intereses",
    lines: [{ description: "Intereses por mora", net_amount: 1000 }], ...over,
  });

  it("es un cargo libre: tipo 2, concepto 'otro', mismo IVA, y no toca el saldo del presupuesto", async () => {
    const ctx = await setup();
    const original = await issuedInvoice(ctx);
    const before = (await detail(ctx)).billing.balances.ARS;
    const res = await as(ctx.actor).post("/invoices").send(debitBody(original));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ kind: "debit_note", cbte_tipo: 2, net_amount: 1000, iva_amount: 210, total_amount: 1210, associated_invoice_id: original.id });
    expect(res.body.data.lines[0]).toMatchObject({ concept: "other", description: "Intereses por mora", credits_line_id: null });
    expect((await emit(ctx, res.body.data.id)).status).toBe(200);
    expect((await detail(ctx)).billing.balances.ARS).toEqual(before);
  });

  it("exige descripción y monto en cada línea, y al menos una", async () => {
    const ctx = await setup();
    const original = await issuedInvoice(ctx);
    const post = (over) => as(ctx.actor).post("/invoices").send(debitBody(original, over));
    expect((await post({ lines: [] })).status).toBe(400);
    expect((await post({ lines: [{ description: " ", net_amount: 10 }] })).body.error).toMatch(/descripción/);
    expect((await post({ lines: [{ description: "x", net_amount: 0 }] })).body.error).toMatch(/monto/);
  });

  it("la ND no exige motivo", async () => {
    const ctx = await setup();
    const original = await issuedInvoice(ctx);
    expect((await as(ctx.actor).post("/invoices").send(debitBody(original, { notes: "" }))).status).toBe(201);
  });
});

describe("emitir una nota de crédito", () => {
  it("manda el comprobante asociado a ARCA, queda emitida con su PDF y libera saldo", async () => {
    const ctx = await setup();
    const original = await issuedInvoice(ctx);
    const before = (await detail(ctx)).billing.balances.ARS.labor;
    const note = await createNote(ctx, original);

    const res = await emit(ctx, note.id);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ arca_status: "authorized", kind: "credit_note", cbte_tipo: 3, number: 1, cae: "76123456789012" });
    expect(res.body.data.file_name).toBe("Nota-de-Crédito-A-0003-00000001.pdf");

    const request = wsfe.requestCae.mock.calls.find((c) => c[0].FeCAEReq.FeCabReq.CbteTipo === 3)[0];
    const d = request.FeCAEReq.FeDetReq.FECAEDetRequest[0];
    expect(d.CbtesAsoc).toEqual({ CbteAsoc: [{ Tipo: 1, PtoVta: 3, Nro: original.number, Cuit: COMPANY_CUIT, CbteFch: TODAY.replace(/-/g, "") }] });
    expect(d).toMatchObject({ ImpNeto: 15000, ImpIVA: 3150, ImpTotal: 18150 });

    // La original sigue viva y el saldo del presupuesto aumentó lo acreditado.
    expect((await db.Invoice.findByPk(original.id)).status).toBe("pending");
    expect((await detail(ctx)).billing.balances.ARS.labor).toBe(before + 15000);
  });

  it("la factura original muestra lo acreditado y cuánto queda de cada línea", async () => {
    const ctx = await setup();
    const original = await issuedInvoice(ctx);
    await emit(ctx, (await createNote(ctx, original)).id);
    await createNote(ctx, original, { lines: [{ credits_line_id: lineOf(original, "labor").id, percent: 20 }] }); // borrador: reserva pero no cuenta como emitida

    const res = await as(ctx.actor).get(`/invoices/${original.id}`);
    expect(res.body.data.credited_total).toBe(18150);
    expect(lineOf(res.body.data, "labor").credited_net).toBe(25000); // 15.000 emitida + 10.000 borrador
    expect(lineOf(res.body.data, "materials").credited_net).toBe(0);
  });

  it("una NC total deja la factura original anulada y libera todo su saldo", async () => {
    const ctx = await setup();
    const original = await issuedInvoice(ctx);
    const before = await detail(ctx);
    expect(before.billing.balances.ARS).toEqual({ materials: 0, labor: 50000 });

    const note = await createNote(ctx, original, {
      lines: [{ credits_line_id: lineOf(original, "labor").id, percent: 100 }, { credits_line_id: lineOf(original, "materials").id, percent: 100 }],
    });
    expect((await emit(ctx, note.id)).status).toBe(200);

    const cancelled = await db.Invoice.findByPk(original.id);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancellation_reason).toMatch(/Anulada con la nota de crédito Nota de Crédito A 0003-00000001/);
    // Saldo: se ve como si la factura nunca hubiera existido (la original no suma y su NC tampoco resta).
    expect((await detail(ctx)).billing.balances.ARS).toEqual({ materials: 20000, labor: 100000 });
  });

  it("dos notas parciales que juntas cubren todo también anulan la original", async () => {
    const ctx = await setup();
    const original = await issuedInvoice(ctx);
    const allMaterials = { credits_line_id: lineOf(original, "materials").id, percent: 100 };
    await emit(ctx, (await createNote(ctx, original, { lines: [allMaterials, { credits_line_id: lineOf(original, "labor").id, percent: 40 }] })).id);
    expect((await db.Invoice.findByPk(original.id)).status).toBe("pending");

    await emit(ctx, (await createNote(ctx, original, { lines: [{ credits_line_id: lineOf(original, "labor").id, percent: 60 }] })).id);
    expect((await db.Invoice.findByPk(original.id)).status).toBe("cancelled");
  });

  it("una nota parcial deja la factura sin anular y baja lo que falta cobrar", async () => {
    const ctx = await setup();
    const original = await issuedInvoice(ctx);
    expect((await detail(ctx)).billing.pending_amount.ARS).toBe(84700); // 70.000 + 21%
    await emit(ctx, (await createNote(ctx, original)).id);
    const after = await detail(ctx);
    expect(after.billing.pending_amount.ARS).toBe(66550); // 84.700 - 18.150
    expect(after.billing.pending_invoices_count).toBe(1); // la nota de crédito no se cobra
  });

  it("los borradores y las rechazadas no figuran como pendientes de cobro", async () => {
    const ctx = await setup();
    await as(ctx.actor).post("/invoices").send({
      source: "arca", budget_id: ctx.budget.id, point_of_sale_id: ctx.pos.id, issue_date: TODAY, currency: "ARS", arca_concept: 1, iva_rate: 21, lines: [{ concept: "labor", percent: 10 }],
    });
    const summary = (await detail(ctx)).billing;
    expect(summary.pending_invoices_count).toBe(0);
    expect(summary.pending_amount.ARS).toBe(0);
    expect(summary.billing_status).toBe("partial");
  });

  it("no se emite si la factura original se anuló mientras tanto, y la nota vuelve a borrador", async () => {
    const ctx = await setup();
    const original = await issuedInvoice(ctx);
    const note = await createNote(ctx, original);
    await db.Invoice.update({ status: "cancelled" }, { where: { id: original.id } });
    const res = await emit(ctx, note.id);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/está anulada/);
    expect(await db.Invoice.findByPk(note.id)).toMatchObject({ arca_status: "draft", number: null });
    expect(wsfe.requestCae.mock.calls.filter((c) => c[0].FeCAEReq.FeCabReq.CbteTipo === 3)).toHaveLength(0);
  });

  it("no se emite con una fecha anterior a la de la factura original", async () => {
    const ctx = await setup();
    const original = await issuedInvoice(ctx);
    const note = await createNote(ctx, original);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    await db.Invoice.update({ issue_date: yesterday }, { where: { id: note.id } });
    const res = await emit(ctx, note.id);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no puede ser anterior a la de la factura original/);
  });

  it("un rechazo de ARCA deja la nota rechazada, explicado, y no toca la original", async () => {
    const ctx = await setup();
    const original = await issuedInvoice(ctx);
    const note = await createNote(ctx, original);
    wsfe.requestCae.mockRejectedValue(new ArcaError("afip", "ARCA rechazó la factura: (10197) Si el comprobante es Debito o Credito, enviar estructura CbteAsoc o PeriodoAsoc.", { details: { codes: [10197] } }));
    const res = await emit(ctx, note.id);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/necesita la factura original asociada/);
    expect(await db.Invoice.findByPk(note.id)).toMatchObject({ arca_status: "rejected", number: null });
    expect((await db.Invoice.findByPk(original.id)).status).toBe("pending");
  });

  it("si ARCA no responde y se verifica, la nota se completa y anula la original si la cubre", async () => {
    const ctx = await setup();
    const original = await issuedInvoice(ctx);
    const note = await createNote(ctx, original, {
      lines: [{ credits_line_id: lineOf(original, "labor").id, percent: 100 }, { credits_line_id: lineOf(original, "materials").id, percent: 100 }],
    });
    wsfe.requestCae.mockRejectedValueOnce(new ArcaError("network", "timeout"));
    expect((await emit(ctx, note.id)).status).toBe(502);
    expect((await db.Invoice.findByPk(original.id)).status).toBe("pending");

    wsfe.getVoucher.mockResolvedValue({ ImpTotal: note.total_amount, DocNro: CLIENT_CUIT, CbteFch: TODAY.replace(/-/g, ""), CodAutorizacion: "76123456789012", FchVto: "20261126", Resultado: "A" });
    const res = await as(ctx.actor).post(`/invoices/${note.id}/verify`).send({});
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("authorized");
    expect((await db.Invoice.findByPk(original.id)).status).toBe("cancelled");
  });

  it("la nota no se edita ni se anula una vez emitida, y no se cobra", async () => {
    const ctx = await setup();
    const original = await issuedInvoice(ctx);
    const note = await createNote(ctx, original);
    await emit(ctx, note.id);
    expect((await as(ctx.actor).put(`/invoices/${note.id}`).send(noteBody(original))).status).toBe(409);
    expect((await as(ctx.actor).put(`/invoices/${note.id}/cancel`).send({ reason: "x" })).status).toBe(409);
    const pay = await as(ctx.actor).put(`/invoices/${note.id}/pay`).send({ paid_at: TODAY });
    expect(pay.status).toBe(409);
    expect(pay.body.error).toMatch(/no se cobra/);
  });

  it("necesita invoices_emit para emitir, igual que una factura", async () => {
    const ctx = await setup();
    const original = await issuedInvoice(ctx);
    const note = await createNote(ctx, original);
    const writer = await createActor({ permissions: ["invoices_read", "invoices_write", "invoices_update"] });
    expect((await as(writer).post(`/invoices/${note.id}/emit`).send({})).status).toBe(401);
  });

  it("un borrador de nota se descarta sin consecuencias para la factura", async () => {
    const ctx = await setup();
    const original = await issuedInvoice(ctx);
    const note = await createNote(ctx, original);
    const res = await as(ctx.actor).put(`/invoices/${note.id}/discard`).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("cancelled");
    expect((await db.Invoice.findByPk(original.id)).status).toBe("pending");
  });
});

describe("el pago de una nota de débito", () => {
  it("una ND emitida se cobra como una factura", async () => {
    const ctx = await setup();
    const original = await issuedInvoice(ctx);
    const debit = (await as(ctx.actor).post("/invoices").send({
      source: "arca", kind: "debit_note", associated_invoice_id: original.id, issue_date: TODAY, lines: [{ description: "Intereses", net_amount: 1000 }],
    })).body.data;
    await emit(ctx, debit.id);
    const res = await as(ctx.actor).put(`/invoices/${debit.id}/pay`).send({ paid_at: TODAY });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("paid");
  });
});

describe("notas de una FCE", () => {
  it("la nota de FCE (203) lleva el opcional 22 en 'N' y no lleva CBU, alias, transferencia ni vencimiento", async () => {
    const ctx = await setup();
    const original = await issuedInvoice(ctx, { fce: true });
    const note = await createNote(ctx, original);
    expect(note).toMatchObject({ cbte_tipo: 203, kind: "credit_note", fce_annulment: false, bank_account_id: null, fce_transfer_option: null });

    expect((await emit(ctx, note.id)).status).toBe(200);
    const request = wsfe.requestCae.mock.calls.find((c) => c[0].FeCAEReq.FeCabReq.CbteTipo === 203)[0];
    const d = request.FeCAEReq.FeDetReq.FECAEDetRequest[0];
    expect(d.Opcionales).toEqual({ Opcional: [{ Id: "22", Valor: "N" }] });
    expect(d).not.toHaveProperty("FchVtoPago");
    expect(d.CbtesAsoc.CbteAsoc[0]).toMatchObject({ Tipo: 201, Nro: original.number });
  });

  it("una nota de débito de FCE es el tipo 202", async () => {
    const ctx = await setup();
    const original = await issuedInvoice(ctx, { fce: true });
    const res = await as(ctx.actor).post("/invoices").send({
      source: "arca", kind: "debit_note", associated_invoice_id: original.id, issue_date: TODAY, lines: [{ description: "Intereses", net_amount: 500 }],
    });
    expect(res.body.data.cbte_tipo).toBe(202);
  });

  it("la anulación (opcional 22 = 'S') solo se admite si el cliente rechazó la FCE (ARCA 10154)", async () => {
    const ctx = await setup();
    const original = await issuedInvoice(ctx, { fce: true });
    const post = () => as(ctx.actor).post("/invoices").send(noteBody(original, { fce_annulment: true }));

    const pending = await post();
    expect(pending.status).toBe(400);
    expect(pending.body.error).toMatch(/solo corresponde si el cliente la rechazó/);

    await as(ctx.actor).put(`/invoices/${original.id}/fce-acceptance`).send({ status: "rejected" });
    const rejected = await post();
    expect(rejected.status).toBe(201);
    expect(rejected.body.data.fce_annulment).toBe(true);

    expect((await emit(ctx, rejected.body.data.id)).status).toBe(200);
    const request = wsfe.requestCae.mock.calls.find((c) => c[0].FeCAEReq.FeCabReq.CbteTipo === 203)[0];
    expect(request.FeCAEReq.FeDetReq.FECAEDetRequest[0].Opcionales).toEqual({ Opcional: [{ Id: "22", Valor: "S" }] });
  });

  it("si se cambió la aceptación entre el borrador y la emisión, no se manda la anulación y se explica", async () => {
    const ctx = await setup();
    const original = await issuedInvoice(ctx, { fce: true });
    await as(ctx.actor).put(`/invoices/${original.id}/fce-acceptance`).send({ status: "rejected" });
    const note = (await as(ctx.actor).post("/invoices").send(noteBody(original, { fce_annulment: true }))).body.data;
    await as(ctx.actor).put(`/invoices/${original.id}/fce-acceptance`).send({ status: "accepted" });
    const res = await emit(ctx, note.id);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/solo corresponde si el cliente la rechazó/);
  });

  it("un rechazo 10154 de ARCA se explica", async () => {
    const ctx = await setup();
    const original = await issuedInvoice(ctx, { fce: true });
    const note = await createNote(ctx, original);
    wsfe.requestCae.mockResolvedValue({
      FeCabResp: { Resultado: "R" },
      FeDetResp: { FECAEDetResponse: { Resultado: "R", Observaciones: { Obs: [{ Code: 10154, Msg: "PtoVta:3 - Tipo:201 - Nro:2 - OK- Comprobante electronico autorizado, NO rechazado por el Comprador." }] } } },
    });
    const res = await emit(ctx, note.id);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/\(10154\)/);
    expect(res.body.error).toMatch(/sin marca de anulación/);
  });
});

describe("filtros y carga manual", () => {
  it("el listado se puede filtrar por tipo de comprobante: facturas, notas de crédito y de débito", async () => {
    const ctx = await setup();
    const original = await issuedInvoice(ctx);
    await createNote(ctx, original);
    await as(ctx.actor).post("/invoices").send({ source: "arca", kind: "debit_note", associated_invoice_id: original.id, issue_date: TODAY, lines: [{ description: "x", net_amount: 10 }] });
    const kinds = async (kind) => (await as(ctx.actor).get(`/invoices?kind=${kind}`)).body.data.map((i) => i.kind);
    expect(await kinds("invoice")).toEqual(["invoice"]);
    expect(await kinds("credit_note")).toEqual(["credit_note"]);
    expect(await kinds("debit_note")).toEqual(["debit_note"]);
  });

  it("las notas ya no se cargan a mano: se hacen desde la factura emitida", async () => {
    const ctx = await setup();
    const manual = (cbte_tipo, voucher_type = "A") => as(ctx.actor).post("/invoices").send({
      voucher_type, cbte_tipo, pos_number: 2, number: 50, issue_date: TODAY, currency: "ARS", budget_id: ctx.budget.id, iva_rate: 21, lines: [{ concept: "labor", percent: 5 }],
    });
    for (const [tipo, letter] of [[3, "A"], [2, "A"], [203, "A"], [202, "A"], [8, "B"], [13, "C"]]) {
      const res = await manual(tipo, letter);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/notas de crédito y de débito se hacen desde la factura emitida/);
    }
    expect((await manual(201)).status).toBe(201); // la FCE sí se sigue cargando a mano
  });
});
