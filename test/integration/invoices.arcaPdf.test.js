"use strict";
// PDF de la factura emitida por ARCA (PLAN_ARCA.md etapa 3, FLOWS.md §66). ARCA y R2 están simulados: nada toca la red ni el bucket.
jest.mock("../../services/arca/wsfe", () => ({
  dummy: jest.fn(), getPointsOfSale: jest.fn(), getLastAuthorized: jest.fn(), getVoucher: jest.fn(), requestCae: jest.fn(),
  getExchangeRate: jest.fn(),
}));
jest.mock("../../helpers/r2Storage", () => ({
  ...jest.requireActual("../../helpers/r2Storage"),
  uploadToR2: jest.fn(),
  deleteFromR2: jest.fn(),
}));

const db = require("../../models");
const wsfe = require("../../services/arca/wsfe");
const { uploadToR2, deleteFromR2 } = require("../../helpers/r2Storage");
const { ArcaError } = require("../../services/arca/errors");
const { todayInArgentina } = require("../../helpers/argentinaDate");
const { createActor, as } = require("../helpers/auth");
const { createClient, createBudget, createBudgetItemType } = require("../factories/budget");

const COMPANY_CUIT = "20123456786";
const CLIENT_CUIT = "30716396653";
const TODAY = todayInArgentina();

let savedEnv;
beforeAll(() => { savedEnv = { env: process.env.ARCA_ENV, cuit: process.env.ARCA_CUIT }; });
afterAll(() => {
  for (const [key, value] of [["ARCA_ENV", savedEnv.env], ["ARCA_CUIT", savedEnv.cuit]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

beforeEach(async () => {
  jest.resetAllMocks();
  uploadToR2.mockImplementation(async (file, folder) => `https://files.test/${folder}/uuid-${file.originalname}`);
  deleteFromR2.mockResolvedValue(undefined);
  process.env.ARCA_ENV = "homologacion";
  process.env.ARCA_CUIT = COMPANY_CUIT;
  await db.CompanyProfile.update(
    { legal_name: "CONMOMET S.A", cuit: COMPANY_CUIT, vat_condition: "responsable_inscripto", address_street: "578 1682", address_locality: "Quequén", address_province: "Buenos Aires" },
    { where: { id: 1 } }
  );
  wsfe.getLastAuthorized.mockResolvedValue(0);
  wsfe.requestCae.mockResolvedValue({
    FeCabResp: { Resultado: "A" },
    FeDetResp: { FECAEDetResponse: [{ Resultado: "A", CbteDesde: 1, CAE: "76123456789012", CAEFchVto: "20261126" }] },
  });
});

async function setup(permissions = ["invoices_read", "invoices_write", "invoices_update", "invoices_emit"]) {
  const actor = await createActor({ permissions });
  const client = await createClient({ cuit: CLIENT_CUIT, tax_condition: "responsable_inscripto", fiscal_street: "Ruta 8", fiscal_locality: "Tancacha", fiscal_province: "Córdoba" });
  const budget = await createBudget({ clientId: client.id, createdBy: actor.user.id, status: "approved", approved_at: new Date() });
  const itemType = await createBudgetItemType();
  await db.BudgetLaborLine.create({ budget_id: budget.id, budget_item_type_id: itemType.id, quantity: 10, unit_price: 10000, estimated_total: 100000 });
  const pos = await db.CompanyPointOfSale.create({ number: 3, usage_description: "Obras", type: "web_service" });
  return { actor, client, budget, pos };
}

const createDraft = async (ctx, overrides = {}) => {
  const res = await as(ctx.actor).post("/invoices").send({
    source: "arca", budget_id: ctx.budget.id, point_of_sale_id: ctx.pos.id, issue_date: TODAY, currency: "ARS", arca_concept: 1, iva_rate: 21,
    lines: [{ concept: "labor", percent: 50 }], ...overrides,
  });
  expect(res.status).toBe(201);
  return res.body.data;
};
const emit = (ctx, id) => as(ctx.actor).post(`/invoices/${id}/emit`).send({});

describe("PDF al emitir", () => {
  it("genera el PDF al autorizar, lo guarda en R2 y lo deja en file_url", async () => {
    const ctx = await setup();
    const draft = await createDraft(ctx);
    const res = await emit(ctx, draft.id);

    expect(res.status).toBe(200);
    expect(res.body.data.file_name).toBe("Factura-A-0003-00000001.pdf");
    expect(res.body.data.file_url).toBe(`https://files.test/invoices/${draft.id}/arca/uuid-Factura-A-0003-00000001.pdf`);

    expect(uploadToR2).toHaveBeenCalledTimes(1);
    const [file, folder] = uploadToR2.mock.calls[0];
    expect(folder).toBe(`invoices/${draft.id}/arca`);
    expect(file).toMatchObject({ originalname: "Factura-A-0003-00000001.pdf", mimetype: "application/pdf" });
    expect(file.buffer.slice(0, 5).toString()).toBe("%PDF-");
  });

  it("si el PDF falla, la factura igual queda emitida con su CAE (se puede regenerar)", async () => {
    const ctx = await setup();
    const draft = await createDraft(ctx);
    uploadToR2.mockRejectedValue(new Error("R2 caído"));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const res = await emit(ctx, draft.id);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ arca_status: "authorized", cae: "76123456789012", file_url: null });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("No se pudo generar el PDF"));
    errorSpy.mockRestore();
  });

  it("también se genera al completar una factura con 'Verificar en ARCA'", async () => {
    const ctx = await setup();
    const draft = await createDraft(ctx);
    wsfe.requestCae.mockRejectedValueOnce(new ArcaError("network", "timeout"));
    await emit(ctx, draft.id);
    expect(uploadToR2).not.toHaveBeenCalled();

    wsfe.getVoucher.mockResolvedValue({ ImpTotal: draft.total_amount, DocNro: CLIENT_CUIT, CbteFch: TODAY.replace(/-/g, ""), CodAutorizacion: "76123456789012", FchVto: "20261126", Resultado: "A" });
    const res = await as(ctx.actor).post(`/invoices/${draft.id}/verify`).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.file_url).toContain("/arca/");
    expect(uploadToR2).toHaveBeenCalledTimes(1);
  });

  it("un borrador no tiene PDF", async () => {
    const ctx = await setup();
    const draft = await createDraft(ctx);
    expect(draft.file_url).toBeNull();
    expect(uploadToR2).not.toHaveBeenCalled();
  });
});

describe("POST /invoices/:id/pdf (regenerar)", () => {
  it("genera el PDF de una emitida que no lo tenía", async () => {
    const ctx = await setup();
    const draft = await createDraft(ctx);
    uploadToR2.mockRejectedValueOnce(new Error("R2 caído"));
    jest.spyOn(console, "error").mockImplementation(() => {});
    await emit(ctx, draft.id);
    console.error.mockRestore();
    expect((await db.Invoice.findByPk(draft.id)).file_url).toBeNull();

    const res = await as(ctx.actor).post(`/invoices/${draft.id}/pdf`).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.file_url).toContain(`invoices/${draft.id}/arca/`);
    expect(deleteFromR2).not.toHaveBeenCalled();
  });

  it("al regenerar reemplaza el PDF anterior generado por el sistema y borra el viejo de R2", async () => {
    const ctx = await setup();
    const draft = await createDraft(ctx);
    const first = (await emit(ctx, draft.id)).body.data.file_url;
    uploadToR2.mockImplementation(async (file, folder) => `https://files.test/${folder}/otro-${file.originalname}`);

    const res = await as(ctx.actor).post(`/invoices/${draft.id}/pdf`).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.file_url).not.toBe(first);
    expect(deleteFromR2).toHaveBeenCalledWith(first);
  });

  it("no borra un archivo que haya subido una persona (fuera de la carpeta arca)", async () => {
    const ctx = await setup();
    const draft = await createDraft(ctx);
    await emit(ctx, draft.id);
    await db.Invoice.update({ file_url: `https://files.test/invoices/${draft.id}/subido-a-mano.pdf` }, { where: { id: draft.id } });
    await as(ctx.actor).post(`/invoices/${draft.id}/pdf`).send({});
    expect(deleteFromR2).not.toHaveBeenCalled();
  });

  it("no se genera el PDF de un borrador (409) ni de una factura cargada a mano (404)", async () => {
    const ctx = await setup();
    const draft = await createDraft(ctx);
    expect((await as(ctx.actor).post(`/invoices/${draft.id}/pdf`).send({})).status).toBe(409);

    const manual = await as(ctx.actor).post("/invoices").send({
      voucher_type: "A", pos_number: 2, number: 10, issue_date: TODAY, currency: "ARS", budget_id: ctx.budget.id, iva_rate: 21, lines: [{ concept: "labor", percent: 10 }],
    });
    expect(manual.status).toBe(201);
    expect((await as(ctx.actor).post(`/invoices/${manual.body.data.id}/pdf`).send({})).status).toBe(404);
    expect(uploadToR2).not.toHaveBeenCalled();
  });

  it("exige invoices_write; con admin_granted también anda", async () => {
    const ctx = await setup();
    const draft = await createDraft(ctx);
    await emit(ctx, draft.id);

    const readOnly = await createActor({ permissions: ["invoices_read"] });
    expect((await as(readOnly).post(`/invoices/${draft.id}/pdf`).send({})).status).toBe(401);
    const admin = await createActor({ role: "admin" });
    expect((await as(admin).post(`/invoices/${draft.id}/pdf`).send({})).status).toBe(200);
  });

  it("sale de los datos congelados: cambiar la empresa o el cliente después no cambia lo que dice la factura", async () => {
    const ctx = await setup();
    const draft = await createDraft(ctx);
    await emit(ctx, draft.id);
    await db.CompanyProfile.update({ legal_name: "OTRA RAZÓN SOCIAL" }, { where: { id: 1 } });
    await ctx.client.update({ razonSocial: "Cliente Renombrado" });

    const res = await as(ctx.actor).post(`/invoices/${draft.id}/pdf`).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.issuer_snapshot.legal_name).toBe("CONMOMET S.A");
    expect(res.body.data.recipient_snapshot.legal_name).not.toBe("Cliente Renombrado");
  });
});
