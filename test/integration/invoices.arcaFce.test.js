"use strict";
// Factura de Crédito Electrónica MiPyMEs por ARCA (PLAN_ARCA.md etapa 4, FLOWS.md §67). ARCA y R2 simulados.
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
const { createClient, createBudget, createBudgetItemType } = require("../factories/budget");

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

const approved = (number) => ({
  FeCabResp: { Resultado: "A" },
  FeDetResp: { FECAEDetResponse: [{ Resultado: "A", CbteDesde: number, CAE: "76123456789012", CAEFchVto: "20261126" }] },
});

beforeEach(async () => {
  jest.clearAllMocks();
  process.env.ARCA_ENV = "homologacion";
  process.env.ARCA_CUIT = COMPANY_CUIT;
  await db.CompanyProfile.update(
    { legal_name: "CONMOMET S.A", cuit: COMPANY_CUIT, vat_condition: "responsable_inscripto", fce_transfer_option: "SCA", address_street: "578 1682", address_locality: "Quequén", address_province: "Buenos Aires" },
    { where: { id: 1 } }
  );
  wsfe.getLastAuthorized.mockResolvedValue(0);
  wsfe.getVoucher.mockResolvedValue(null);
  wsfe.requestCae.mockImplementation(async (req) => approved(req.FeCAEReq.FeDetReq.FECAEDetRequest[0].CbteDesde));
});

async function setup({ permissions = ["invoices_read", "invoices_write", "invoices_update", "invoices_emit"], clientOverrides = {}, bank = {} } = {}) {
  const actor = await createActor({ permissions });
  const client = await createClient({ cuit: CLIENT_CUIT, tax_condition: "responsable_inscripto", ...clientOverrides });
  const budget = await createBudget({ clientId: client.id, createdBy: actor.user.id, status: "approved", approved_at: new Date() });
  const itemType = await createBudgetItemType();
  await db.BudgetLaborLine.create({ budget_id: budget.id, budget_item_type_id: itemType.id, quantity: 10, unit_price: 10000, estimated_total: 100000 });
  const pos = await db.CompanyPointOfSale.create({ number: 3, usage_description: "Obras", type: "web_service" });
  const account = await db.CompanyBankAccount.create({ bank_name: "Banco X", cbu: VALID_CBU, alias: "CONMOMET.COBROS", is_default: true, ...bank });
  return { actor, client, budget, pos, account };
}

const draftBody = (ctx, over = {}) => ({
  source: "arca", cbte_tipo: 201, budget_id: ctx.budget.id, point_of_sale_id: ctx.pos.id, issue_date: TODAY, due_date: IN_30_DAYS, currency: "ARS",
  arca_concept: 1, iva_rate: 21, lines: [{ concept: "labor", percent: 50 }], commercial_reference: "OC 4104017010", ...over,
});
const createDraft = async (ctx, over) => {
  const res = await as(ctx.actor).post("/invoices").send(draftBody(ctx, over));
  expect(res.status).toBe(201);
  return res.body.data;
};
const emit = (ctx, id) => as(ctx.actor).post(`/invoices/${id}/emit`).send({});

describe("borrador de FCE", () => {
  it("se crea con tipo 201, la cuenta predeterminada y la opción de transferencia de la empresa", async () => {
    const ctx = await setup();
    const invoice = await createDraft(ctx);
    expect(invoice).toMatchObject({ cbte_tipo: 201, source: "arca", arca_status: "draft", bank_account_id: ctx.account.id, fce_transfer_option: "SCA" });
    expect(invoice.bankAccount).toMatchObject({ bank_name: "Banco X", alias: "CONMOMET.COBROS" });
  });

  it("la opción de transferencia del cliente gana a la de la empresa, y una elegida a mano gana a las dos", async () => {
    const ctx = await setup({ clientOverrides: { fce_transfer_option: "ADC" } });
    expect((await createDraft(ctx)).fce_transfer_option).toBe("ADC");
    expect((await createDraft(ctx, { fce_transfer_option: "SCA", lines: [{ concept: "labor", percent: 10 }] })).fce_transfer_option).toBe("SCA");
  });

  it("elige la cuenta predeterminada que sirva para la moneda de la factura", async () => {
    const ctx = await setup({ bank: { currency: "USD" } });
    const arsAccount = await db.CompanyBankAccount.create({ bank_name: "Banco Pesos", cbu: "0140999840000000000008", currency: "ARS" });
    const invoice = await createDraft(ctx);
    expect(invoice.bank_account_id).toBe(arsAccount.id);
  });

  it("acepta elegir otra cuenta, y rechaza una inexistente o inactiva", async () => {
    const ctx = await setup();
    const other = await db.CompanyBankAccount.create({ bank_name: "Otro", cbu: "0140999840000000000008" });
    expect((await createDraft(ctx, { bank_account_id: other.id })).bank_account_id).toBe(other.id);
    const inactive = await db.CompanyBankAccount.create({ bank_name: "Inactiva", cbu: "0110059920000001234567", is_active: false });
    for (const id of [inactive.id, 99999]) {
      const res = await as(ctx.actor).post("/invoices").send(draftBody(ctx, { bank_account_id: id }));
      expect(res.status).toBe(400);
    }
  });

  it("rechaza una opción de transferencia inválida y un tipo de comprobante que la app no emite", async () => {
    const ctx = await setup();
    expect((await as(ctx.actor).post("/invoices").send(draftBody(ctx, { fce_transfer_option: "XXX" }))).status).toBe(400);
    expect((await as(ctx.actor).post("/invoices").send(draftBody(ctx, { cbte_tipo: 6 }))).status).toBe(400);
    expect((await as(ctx.actor).post("/invoices").send(draftBody(ctx, { cbte_tipo: 3 }))).status).toBe(400);
  });

  it("una Factura A no guarda cuenta ni opción de transferencia", async () => {
    const ctx = await setup();
    const invoice = await createDraft(ctx, { cbte_tipo: 1 });
    expect(invoice).toMatchObject({ cbte_tipo: 1, bank_account_id: null, fce_transfer_option: null });
  });

  it("se puede pasar un borrador de Factura A a FCE y al revés", async () => {
    const ctx = await setup();
    const draft = await createDraft(ctx, { cbte_tipo: 1 });
    const toFce = await as(ctx.actor).put(`/invoices/${draft.id}`).send(draftBody(ctx));
    expect(toFce.body.data).toMatchObject({ cbte_tipo: 201, bank_account_id: ctx.account.id });
    const toA = await as(ctx.actor).put(`/invoices/${draft.id}`).send(draftBody(ctx, { cbte_tipo: 1 }));
    expect(toA.body.data).toMatchObject({ cbte_tipo: 1, bank_account_id: null, fce_transfer_option: null });
  });
});

describe("emitir una FCE", () => {
  it("manda el tipo 201, el vencimiento, y los opcionales de ARCA: CBU, alias, transferencia y referencia comercial", async () => {
    const ctx = await setup();
    const draft = await createDraft(ctx);
    const res = await emit(ctx, draft.id);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ arca_status: "authorized", cbte_tipo: 201, number: 1, cae: "76123456789012", fce_acceptance: "pending" });
    const request = wsfe.requestCae.mock.calls[0][0];
    expect(request.FeCAEReq.FeCabReq).toEqual({ CantReg: 1, PtoVta: 3, CbteTipo: 201 });
    const detail = request.FeCAEReq.FeDetReq.FECAEDetRequest[0];
    expect(detail.FchVtoPago).toBe(IN_30_DAYS.replace(/-/g, ""));
    expect(detail.Opcionales.Opcional).toEqual([
      { Id: "2101", Valor: VALID_CBU }, { Id: "2102", Valor: "CONMOMET.COBROS" }, { Id: "27", Valor: "SCA" }, { Id: "23", Valor: "OC 4104017010" },
    ]);
  });

  it("congela el CBU y el alias en la factura: editar o cambiar la cuenta después no la modifica", async () => {
    const ctx = await setup();
    const draft = await createDraft(ctx);
    await emit(ctx, draft.id);
    await ctx.account.update({ cbu: "0140999840000000000008", alias: "OTRO.ALIAS.NUEVO", bank_name: "Banco Cambiado" });

    const res = await as(ctx.actor).get(`/invoices/${draft.id}`);
    expect(res.body.data.issuer_snapshot.bank).toEqual({ bank_name: "Banco X", cbu: VALID_CBU, alias: "CONMOMET.COBROS" });
  });

  it("la numeración de la FCE es independiente de la de la Factura A (B1)", async () => {
    const ctx = await setup();
    const factura = await createDraft(ctx, { cbte_tipo: 1, lines: [{ concept: "labor", percent: 20 }] });
    const fce = await createDraft(ctx, { lines: [{ concept: "labor", percent: 20 }] });
    wsfe.getLastAuthorized.mockImplementation(async (pos, tipo) => (tipo === 1 ? 41 : 7));
    wsfe.getVoucher.mockResolvedValue({ CbteFch: "20200101" });

    expect((await emit(ctx, factura.id)).body.data.number).toBe(42);
    expect((await emit(ctx, fce.id)).body.data.number).toBe(8);
    expect(wsfe.getLastAuthorized).toHaveBeenCalledWith(3, 1);
    expect(wsfe.getLastAuthorized).toHaveBeenCalledWith(3, 201);
  });

  it("genera el PDF de la FCE con el CBU congelado", async () => {
    const ctx = await setup();
    const draft = await createDraft(ctx);
    const res = await emit(ctx, draft.id);
    expect(res.body.data.file_name).toBe("Factura-de-Crédito-Electrónica-A-0003-00000001.pdf");
  });

  it("sin cuenta bancaria, con CBU inválido o sin opción de transferencia frena antes de llamar a ARCA", async () => {
    const ctx = await setup();
    const draft = await createDraft(ctx);

    await db.Invoice.update({ bank_account_id: null }, { where: { id: draft.id } });
    let res = await emit(ctx, draft.id);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cuenta bancaria del emisor/);

    await ctx.account.update({ cbu: "0170099220000067797380" }); // dígito verificador mal: homologación lo aceptaría, la app no
    await db.Invoice.update({ bank_account_id: ctx.account.id, fce_transfer_option: null }, { where: { id: draft.id } });
    res = await emit(ctx, draft.id);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/CBU .* no es válido/);
    expect(res.body.error).toMatch(/opción de transferencia/);

    expect(wsfe.getLastAuthorized).not.toHaveBeenCalled();
    expect(await db.Invoice.findByPk(draft.id)).toMatchObject({ arca_status: "draft", number: null });
  });

  it("exige el vencimiento de pago aunque se facture solo productos, y limita la referencia comercial a 50 caracteres", async () => {
    const ctx = await setup();
    const noDue = await createDraft(ctx, { due_date: null });
    const noDueRes = await emit(ctx, noDue.id);
    expect(noDueRes.status).toBe(400);
    expect(noDueRes.body.error).toMatch(/necesita el vencimiento de pago/);

    const longRef = await createDraft(ctx, { commercial_reference: "x".repeat(60), lines: [{ concept: "labor", percent: 10 }] });
    const longRes = await emit(ctx, longRef.id);
    expect(longRes.status).toBe(400);
    expect(longRes.body.error).toMatch(/hasta 50 caracteres/);
  });

  it("un rechazo de ARCA por cliente no registrado se explica y deja la FCE rechazada, sin número", async () => {
    const ctx = await setup();
    const draft = await createDraft(ctx);
    wsfe.requestCae.mockResolvedValue({
      FeCabResp: { Resultado: "R" },
      FeDetResp: { FECAEDetResponse: { Resultado: "R", Observaciones: { Obs: [{ Code: 10176, Msg: "Factura de Credito tipo A, DocTipo: 80, DocNro 30716396653 no se encuentra registrado en los padrones de AFIP o se encuentra inactivo." }] } } },
    });
    const res = await emit(ctx, draft.id);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/\(10176\)/);
    expect(res.body.error).toMatch(/revisá su CUIT en Clientes/);
    expect(res.body.error).toMatch(/33693450239/); // homologación
    expect(await db.Invoice.findByPk(draft.id)).toMatchObject({ arca_status: "rejected", number: null });
  });

  it("los demás rechazos de la FCE también traen la explicación", async () => {
    const ctx = await setup();
    const draft = await createDraft(ctx);
    const { ArcaError } = require("../../services/arca/errors");
    wsfe.requestCae.mockRejectedValue(new ArcaError("afip", "ARCA rechazó la factura: (10069) Campo DocNro no puede ser igual al del emisor.", { details: { codes: [10069] } }));
    const res = await emit(ctx, draft.id);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/no puede ser el mismo que el de la empresa/);
  });

  it("no se puede emitir una FCE a un cliente con el CUIT de la propia empresa (ARCA 10069)", async () => {
    const ctx = await setup({ clientOverrides: { cuit: COMPANY_CUIT } });
    const draft = await createDraft(ctx);
    const res = await emit(ctx, draft.id);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no puede ser el mismo/);
  });

  it("una FCE emitida tampoco se edita ni se anula por la ruta vieja (B4)", async () => {
    const ctx = await setup();
    const draft = await createDraft(ctx);
    await emit(ctx, draft.id);
    expect((await as(ctx.actor).put(`/invoices/${draft.id}`).send(draftBody(ctx))).status).toBe(409);
    expect((await as(ctx.actor).put(`/invoices/${draft.id}/cancel`).send({ reason: "x" })).status).toBe(409);
  });
});

describe("aceptación de la FCE", () => {
  it("ya no se carga a mano: la ruta no existe y la factura nace pendiente hasta sincronizar con ARCA", async () => {
    const ctx = await setup();
    const draft = await createDraft(ctx);
    await emit(ctx, draft.id);
    expect((await as(ctx.actor).get(`/invoices/${draft.id}`)).body.data.fce_acceptance).toBe("pending");
    const admin = await createActor({ role: "admin" });
    expect((await as(admin).put(`/invoices/${draft.id}/fce-acceptance`).send({ status: "accepted" })).status).toBe(404);
    expect((await db.Invoice.findByPk(draft.id)).fce_acceptance).toBe("pending");
  });
});

describe("cuentas bancarias y opciones", () => {
  it("una cuenta usada en una factura no se puede eliminar (se desactiva)", async () => {
    const ctx = await setup();
    await createDraft(ctx);
    const settings = await createActor({ permissions: ["company_settings_update"] });
    const res = await as(settings).delete(`/company-settings/bank-accounts/${ctx.account.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Desactivala/);
    expect(await db.CompanyBankAccount.findByPk(ctx.account.id)).toBeTruthy();
  });

  it("las opciones de ARCA traen las cuentas activas y la opción de transferencia por defecto de la empresa", async () => {
    const ctx = await setup();
    await db.CompanyBankAccount.create({ bank_name: "Inactiva", cbu: "0140999840000000000008", is_active: false });
    await db.CompanyProfile.update({ fce_transfer_option: "ADC" }, { where: { id: 1 } });
    const res = await as(ctx.actor).get("/invoices/arca/options");
    expect(res.body.data.bank_accounts.map((a) => a.bank_name)).toEqual(["Banco X"]);
    expect(res.body.data.bank_accounts[0]).toMatchObject({ cbu: VALID_CBU, alias: "CONMOMET.COBROS", is_default: true });
    expect(res.body.data.company_fce_transfer_option).toBe("ADC");
  });

  it("el cliente puede tener su propia opción de transferencia (SCA, ADC o heredar la de la empresa)", async () => {
    const actor = await createActor({ permissions: ["clients_write", "clients_update"] });
    const created = await as(actor).post("/clients").send({ razonSocial: "Bunge", email: "b@test.local", fce_transfer_option: "ADC" });
    const id = created.body.client.id;
    expect((await db.Client.findByPk(id)).fce_transfer_option).toBe("ADC");

    expect((await as(actor).put(`/clients/${id}`).send({ is_active: true })).status).toBe(200);
    expect((await db.Client.findByPk(id)).fce_transfer_option).toBe("ADC"); // update parcial: no se pisa

    expect((await as(actor).put(`/clients/${id}`).send({ fce_transfer_option: "" })).status).toBe(200);
    expect((await db.Client.findByPk(id)).fce_transfer_option).toBeNull();

    const bad = await as(actor).put(`/clients/${id}`).send({ fce_transfer_option: "XXX" });
    expect(bad.status).toBe(400);
  });
});
