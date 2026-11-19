"use strict";
// Vista previa del borrador con el formato de la factura final (FLOWS.md §76). ARCA simulada: nada toca la red.
jest.mock("../../services/arca/wsfe", () => ({
  dummy: jest.fn(), getPointsOfSale: jest.fn(), getLastAuthorized: jest.fn(), getVoucher: jest.fn(), requestCae: jest.fn(),
  getExchangeRate: jest.fn(),
}));
jest.mock("../../helpers/r2Storage", () => ({
  ...jest.requireActual("../../helpers/r2Storage"),
  uploadToR2: jest.fn(async (file, folder) => `https://files.test/${folder}/uuid-${file.originalname}`),
  deleteFromR2: jest.fn(),
}));

const db = require("../../models");
const wsfe = require("../../services/arca/wsfe");
const { todayInArgentina } = require("../../helpers/argentinaDate");
const { createActor, as } = require("../helpers/auth");
const { createClient, createBudget, createBudgetItemType } = require("../factories/budget");

const COMPANY_CUIT = "20123456786";
const TODAY = todayInArgentina();

let savedEnv;
beforeAll(() => { savedEnv = { env: process.env.ARCA_ENV, cuit: process.env.ARCA_CUIT }; });
afterAll(() => {
  for (const [key, value] of [["ARCA_ENV", savedEnv.env], ["ARCA_CUIT", savedEnv.cuit]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

beforeEach(async () => {
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
  const client = await createClient({ cuit: "30716396653", tax_condition: "responsable_inscripto", fiscal_street: "Ruta 8", fiscal_locality: "Tancacha", fiscal_province: "Córdoba" });
  const budget = await createBudget({ clientId: client.id, createdBy: actor.user.id, status: "approved", approved_at: new Date() });
  const itemType = await createBudgetItemType();
  await db.BudgetLaborLine.create({ budget_id: budget.id, budget_item_type_id: itemType.id, quantity: 10, unit_price: 10000, estimated_total: 100000 });
  const pos = await db.CompanyPointOfSale.create({ number: 3, usage_description: "Obras", type: "web_service" });
  return { actor, client, budget, pos };
}

const createDraft = async (ctx) => {
  const res = await as(ctx.actor).post("/invoices").send({
    source: "arca", budget_id: ctx.budget.id, point_of_sale_id: ctx.pos.id, issue_date: TODAY, currency: "ARS", arca_concept: 1, iva_rate: 21,
    lines: [{ concept: "labor", percent: 50 }],
  });
  expect(res.status).toBe(201);
  return res.body.data;
};

const binary = (res, cb) => { res.setEncoding("binary"); let data = ""; res.on("data", (c) => { data += c; }); res.on("end", () => cb(null, Buffer.from(data, "binary"))); };

describe("GET /invoices/:id/preview-pdf", () => {
  it("devuelve un PDF del borrador sin guardarlo ni llamar a ARCA", async () => {
    const ctx = await setup();
    const draft = await createDraft(ctx);
    const res = await as(ctx.actor).get(`/invoices/${draft.id}/preview-pdf`).buffer(true).parse(binary);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    expect(res.headers["content-disposition"]).toMatch(/^inline/);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.slice(0, 4).toString()).toBe("%PDF");

    // No emitió ni guardó nada: sigue siendo borrador, sin número ni archivo.
    expect(wsfe.requestCae).not.toHaveBeenCalled();
    const fresh = await db.Invoice.findByPk(draft.id);
    expect(fresh.arca_status).toBe("draft");
    expect(fresh.number).toBeNull();
    expect(fresh.file_url).toBeNull();
  });

  it("una factura ya emitida responde 409 (ya tiene su PDF real)", async () => {
    const ctx = await setup();
    const draft = await createDraft(ctx);
    expect((await as(ctx.actor).post(`/invoices/${draft.id}/emit`).send({})).status).toBe(200);
    const res = await as(ctx.actor).get(`/invoices/${draft.id}/preview-pdf`);
    expect(res.status).toBe(409);
  });

  it("factura inexistente: 404", async () => {
    const ctx = await setup();
    expect((await as(ctx.actor).get("/invoices/999999/preview-pdf")).status).toBe(404);
  });

  it("pide invoices_read: sin él 401; con admin_granted pasa", async () => {
    const ctx = await setup();
    const draft = await createDraft(ctx);
    const without = await createActor({ permissions: ["clients_read"] });
    expect((await as(without).get(`/invoices/${draft.id}/preview-pdf`)).status).toBe(401);
    const admin = await createActor({ role: "admin" });
    expect((await as(admin).get(`/invoices/${draft.id}/preview-pdf`)).status).toBe(200);
  });
});
