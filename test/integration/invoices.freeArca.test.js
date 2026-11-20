"use strict";
// Factura libre por ARCA a un cliente ocasional (el comprador se escribe a mano y queda solo en la factura). FLOWS.md §76. ARCA y R2 simulados.
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
const { todayInArgentina } = require("../../helpers/argentinaDate");
const { createActor, as } = require("../helpers/auth");
const { createClient, createBudget } = require("../factories/budget");

const COMPANY_CUIT = "20123456786";
const BUYER_CUIT = "30716396653";
const TODAY = todayInArgentina();
const PERMS = ["invoices_read", "invoices_write", "invoices_update", "invoices_delete", "invoices_emit"];

let savedEnv;
beforeAll(() => { savedEnv = { env: process.env.ARCA_ENV, cuit: process.env.ARCA_CUIT }; });
afterAll(() => {
  for (const [key, value] of [["ARCA_ENV", savedEnv.env], ["ARCA_CUIT", savedEnv.cuit]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

let lastNumber = 0;
beforeEach(async () => {
  jest.clearAllMocks();
  lastNumber = 0;
  process.env.ARCA_ENV = "homologacion";
  process.env.ARCA_CUIT = COMPANY_CUIT;
  await db.CompanyProfile.update(
    { legal_name: "CONMOMET S.A", cuit: COMPANY_CUIT, vat_condition: "responsable_inscripto", fce_transfer_option: "SCA", address_street: "578 1682", address_locality: "Quequén", address_province: "Buenos Aires" },
    { where: { id: 1 } }
  );
  wsfe.getLastAuthorized.mockImplementation(async () => lastNumber);
  wsfe.getVoucher.mockResolvedValue(null);
  wsfe.requestCae.mockImplementation(async (req) => {
    const number = req.FeCAEReq.FeDetReq.FECAEDetRequest[0].CbteDesde;
    lastNumber = number;
    return {
      FeCabResp: { Resultado: "A" },
      FeDetResp: { FECAEDetResponse: [{ Resultado: "A", CbteDesde: number, CAE: "76123456789012", CAEFchVto: "20261126" }] },
    };
  });
});

const buyer = (over = {}) => ({
  legal_name: "Transportes del Sur S.R.L.", cuit: BUYER_CUIT, tax_condition: "responsable_inscripto",
  fiscal_street: "Ruta 3 km 400", fiscal_locality: "Tres Arroyos", fiscal_province: "Buenos Aires", ...over,
});

async function setup() {
  const actor = await createActor({ permissions: PERMS });
  const pos = await db.CompanyPointOfSale.create({ number: 3, usage_description: "Obras", type: "web_service" });
  return { actor, pos };
}

const draftBody = (ctx, over = {}) => ({
  source: "arca", cbte_tipo: 1, point_of_sale_id: ctx.pos.id, arca_concept: 1, issue_date: TODAY, currency: "ARS", iva_rate: 21,
  manual_recipient: buyer(), lines: [{ concept: "other", description: "Venta de camioneta Toyota Hilux, dominio AB123CD", net_amount: 10000000 }], ...over,
});
const create = (ctx, over) => as(ctx.actor).post("/invoices").send(draftBody(ctx, over));

describe("borrador a un cliente ocasional", () => {
  it("se guarda sin cliente cargado, con el comprador en la factura y el IVA del receptor según su condición", async () => {
    const ctx = await setup();
    const res = await create(ctx);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      client_id: null, project_id: null, budget_id: null, source: "arca", arca_status: "draft", net_amount: 10000000, iva_amount: 2100000, total_amount: 12100000,
      recipient_doc_number: BUYER_CUIT, recipient_vat_condition_id: 1,
      manual_recipient: { legal_name: "Transportes del Sur S.R.L.", cuit: BUYER_CUIT, tax_condition: "responsable_inscripto", fiscal_locality: "Tres Arroyos" },
    });
    expect(res.body.data.lines[0]).toMatchObject({ concept: "other", budget_id: null });
    expect(await db.Client.count()).toBe(0); // no se da de alta en Clientes
  });

  it("un Monotributo se mapea a su condición de IVA (6)", async () => {
    const ctx = await setup();
    const res = await create(ctx, { manual_recipient: buyer({ tax_condition: "monotributo" }) });
    expect(res.body.data.recipient_vat_condition_id).toBe(6);
  });

  it("llega igual como multipart (el JSON del comprador va en un string)", async () => {
    const ctx = await setup();
    const res = await as(ctx.actor).post("/invoices")
      .field("source", "arca").field("cbte_tipo", "1").field("point_of_sale_id", String(ctx.pos.id)).field("arca_concept", "1").field("issue_date", TODAY)
      .field("currency", "ARS").field("iva_rate", "21").field("manual_recipient", JSON.stringify(buyer({ cuit: "30-71639665-3" })))
      .field("lines", JSON.stringify([{ concept: "other", description: "Venta", net_amount: 1000 }]));
    expect(res.status).toBe(201);
    expect(res.body.data.manual_recipient.cuit).toBe(BUYER_CUIT); // se guarda normalizado
  });

  it("el listado y el detalle muestran al comprador como cliente", async () => {
    const ctx = await setup();
    const created = (await create(ctx)).body.data;
    expect(created.client).toMatchObject({ id: null, razonSocial: "Transportes del Sur S.R.L.", cuit: BUYER_CUIT, manual: true });
    const list = (await as(ctx.actor).get("/invoices")).body.data;
    expect(list.find((i) => i.id === created.id).client.razonSocial).toBe("Transportes del Sur S.R.L.");
  });

  it.each([
    ["sin nombre", { legal_name: " " }, /razón social o el nombre/],
    ["con CUIT inválido", { cuit: "30716396650" }, /CUIT del cliente no es válido/],
    ["sin CUIT", { cuit: "" }, /CUIT del cliente no es válido/],
    ["exento (no admite Factura A)", { tax_condition: "exento" }, /Responsable Inscripto o Monotributo/],
    ["consumidor final", { tax_condition: "consumidor_final" }, /Responsable Inscripto o Monotributo/],
  ])("rechaza un comprador %s", async (_label, overrides, message) => {
    const ctx = await setup();
    const res = await create(ctx, { manual_recipient: buyer(overrides) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
    expect(await db.Invoice.count()).toBe(0);
  });

  it("los datos de un string que no es JSON se rechazan", async () => {
    const ctx = await setup();
    const res = await create(ctx, { manual_recipient: "{no es json" });
    expect(res.status).toBe(400);
  });

  it("sin cliente cargado ni comprador ocasional pide el cliente", async () => {
    const ctx = await setup();
    const res = await create(ctx, { manual_recipient: undefined });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cliente es obligatorio/);
  });

  it("el comprador ocasional solo vale en una factura libre", async () => {
    const ctx = await setup();
    const client = await createClient();
    const budget = await createBudget({ clientId: client.id, createdBy: ctx.actor.user.id, status: "approved", approved_at: new Date() });
    const res = await create(ctx, { budget_id: budget.id, lines: [{ concept: "labor", percent: 10 }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/solo se usa en una factura libre/);
  });

  it("y solo al emitir por ARCA: en una factura cargada a mano hay que elegir un cliente", async () => {
    const ctx = await setup();
    const res = await as(ctx.actor).post("/invoices").send({
      voucher_type: "A", pos_number: 1, number: 12, issue_date: TODAY, currency: "ARS", iva_rate: 21, manual_recipient: buyer(),
      lines: [{ concept: "other", description: "Venta", net_amount: 1000 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/solo se usa al emitir por ARCA/);
  });

  it("se puede editar el borrador y pasar a un cliente cargado (y el comprador manual se borra)", async () => {
    const ctx = await setup();
    const created = (await create(ctx)).body.data;
    const edited = await as(ctx.actor).put(`/invoices/${created.id}`).send(draftBody(ctx, { manual_recipient: buyer({ legal_name: "Otra Empresa S.A." }) }));
    expect(edited.status).toBe(200);
    expect(edited.body.data.manual_recipient.legal_name).toBe("Otra Empresa S.A.");
    const client = await createClient({ cuit: BUYER_CUIT, tax_condition: "responsable_inscripto" });
    const toClient = await as(ctx.actor).put(`/invoices/${created.id}`).send(draftBody(ctx, { manual_recipient: undefined, client_id: client.id }));
    expect(toClient.status).toBe(200);
    expect(toClient.body.data).toMatchObject({ client_id: client.id, manual_recipient: null });
  });
});

describe("vista previa y emisión", () => {
  it("la vista previa en PDF funciona con el comprador ocasional", async () => {
    const ctx = await setup();
    const created = (await create(ctx)).body.data;
    const res = await as(ctx.actor).get(`/invoices/${created.id}/preview-pdf`).buffer(true).parse((r, cb) => {
      const chunks = []; r.on("data", (c) => chunks.push(c)); r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    expect(res.body.slice(0, 4).toString()).toBe("%PDF");
  });

  it("se emite en ARCA: el comprador queda congelado en el snapshot y el PDF sale a su nombre", async () => {
    const ctx = await setup();
    const created = (await create(ctx)).body.data;
    const res = await as(ctx.actor).post(`/invoices/${created.id}/emit`).send({});
    expect(res.status).toBe(200);
    const invoice = (await as(ctx.actor).get(`/invoices/${created.id}`)).body.data;
    expect(invoice).toMatchObject({ arca_status: "authorized", cae: "76123456789012", client_id: null });
    expect(invoice.recipient_snapshot).toMatchObject({
      legal_name: "Transportes del Sur S.R.L.", cuit: BUYER_CUIT, vat_condition_id: 1, address: { street: "Ruta 3 km 400", locality: "Tres Arroyos", province: "Buenos Aires" },
    });
    // El pedido a ARCA lleva el CUIT del comprador y la condición de IVA del receptor.
    const request = wsfe.requestCae.mock.calls[0][0].FeCAEReq.FeDetReq.FECAEDetRequest[0];
    expect(request).toMatchObject({ DocTipo: 80, DocNro: Number(BUYER_CUIT), CondicionIVAReceptorId: 1, ImpNeto: 10000000, ImpIVA: 2100000 });
    expect(invoice.file_url).toMatch(/invoices\/\d+\/arca\//);
  });

  it("emitir con la empresa como comprador se frena (el CUIT no puede ser el mismo)", async () => {
    const ctx = await setup();
    const created = (await create(ctx, { manual_recipient: buyer({ cuit: COMPANY_CUIT }) })).body.data;
    const res = await as(ctx.actor).post(`/invoices/${created.id}/emit`).send({});
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(res.body)).toMatch(/mismo que el de la empresa/);
    expect(wsfe.requestCae).not.toHaveBeenCalled();
  });

  it("una nota de crédito sobre la factura hereda al comprador ocasional y se emite", async () => {
    const ctx = await setup();
    const created = (await create(ctx)).body.data;
    await as(ctx.actor).post(`/invoices/${created.id}/emit`).send({});
    const original = (await as(ctx.actor).get(`/invoices/${created.id}`)).body.data;
    const note = await as(ctx.actor).post("/invoices").send({
      source: "arca", kind: "credit_note", associated_invoice_id: original.id, issue_date: TODAY, notes: "Venta anulada",
      lines: [{ credits_line_id: original.lines[0].id, percent: 100 }],
    });
    expect(note.status).toBe(201);
    expect(note.body.data).toMatchObject({ client_id: null, manual_recipient: { legal_name: "Transportes del Sur S.R.L." } });
    const emitted = await as(ctx.actor).post(`/invoices/${note.body.data.id}/emit`).send({});
    expect(emitted.status).toBe(200);
    const request = wsfe.requestCae.mock.calls[1][0].FeCAEReq.FeDetReq.FECAEDetRequest[0];
    expect(request).toMatchObject({ DocNro: Number(BUYER_CUIT) });
  });
});

describe("permisos", () => {
  it("cargar el borrador pide invoices_write y emitir invoices_emit", async () => {
    const ctx = await setup();
    const reader = await createActor({ permissions: ["invoices_read"] });
    const writer = await createActor({ permissions: ["invoices_write"] });
    expect((await as(reader).post("/invoices").send(draftBody(ctx))).status).toBe(401);
    const created = await as(writer).post("/invoices").send(draftBody(ctx));
    expect(created.status).toBe(201);
    expect((await as(writer).post(`/invoices/${created.body.data.id}/emit`).send({})).status).toBe(401);
  });
});
