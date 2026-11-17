"use strict";
// Emisión de Factura A por ARCA (PLAN_ARCA.md etapa 2, FLOWS.md §65). ARCA está simulado: el wsfe real nunca se llama.
jest.mock("../../services/arca/wsfe", () => ({
  dummy: jest.fn(), getPointsOfSale: jest.fn(), getLastAuthorized: jest.fn(), getVoucher: jest.fn(), requestCae: jest.fn(),
  getExchangeRate: jest.fn(),
}));

const db = require("../../models");
const wsfe = require("../../services/arca/wsfe");
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
  process.env.ARCA_ENV = "homologacion";
  process.env.ARCA_CUIT = COMPANY_CUIT;
  await db.CompanyProfile.update(
    {
      legal_name: "CONMOMET S.A", cuit: COMPANY_CUIT, vat_condition: "responsable_inscripto",
      address_street: "578 1682", address_locality: "Quequén", address_province: "Buenos Aires",
    },
    { where: { id: 1 } }
  );
});

const approvedResponse = (number = 1) => ({
  FeCabResp: { Resultado: "A", FchProceso: "20261116101010" },
  FeDetResp: { FECAEDetResponse: [{ Resultado: "A", CbteDesde: number, CAE: "76123456789012", CAEFchVto: "20261126" }] },
});

async function setup({ permissions = ["invoices_read", "invoices_write", "invoices_update", "invoices_emit"], clientOverrides = {}, amount = 100000 } = {}) {
  const actor = await createActor({ permissions });
  const client = await createClient({ cuit: CLIENT_CUIT, tax_condition: "responsable_inscripto", ...clientOverrides });
  const budget = await createBudget({ clientId: client.id, createdBy: actor.user.id, status: "approved", approved_at: new Date() });
  const itemType = await createBudgetItemType();
  await db.BudgetLaborLine.create({ budget_id: budget.id, budget_item_type_id: itemType.id, quantity: 10, unit_price: amount / 10, estimated_total: amount });
  const pos = await db.CompanyPointOfSale.create({ number: 3, usage_description: "Obras", type: "web_service" });
  return { actor, client, budget, pos };
}

const draftBody = (ctx, overrides = {}) => ({
  source: "arca", budget_id: ctx.budget.id, point_of_sale_id: ctx.pos.id, issue_date: TODAY, currency: "ARS",
  arca_concept: 1, iva_rate: 21, lines: [{ concept: "labor", percent: 50 }], ...overrides,
});
const createDraft = async (ctx, overrides) => {
  const res = await as(ctx.actor).post("/invoices").send(draftBody(ctx, overrides));
  expect(res.status).toBe(201);
  return res.body.data;
};
const reload = (id) => db.Invoice.findByPk(id);

describe("POST /invoices con source arca (borrador)", () => {
  it("crea un borrador de Factura A sin número, con el receptor tomado del cliente", async () => {
    const ctx = await setup();
    const invoice = await createDraft(ctx);
    expect(invoice).toMatchObject({
      source: "arca", arca_status: "draft", voucher_type: "A", cbte_tipo: 1, pos_number: 3, number: null, status: "pending",
      recipient_doc_type: 80, recipient_doc_number: CLIENT_CUIT, recipient_vat_condition_id: 1, arca_concept: 1,
      net_amount: 50000, iva_amount: 10500, total_amount: 60500, total_amount_ars: 60500,
    });
  });

  it("ignora el número que mande el cliente y no adjunta PDF a mano", async () => {
    const ctx = await setup();
    const invoice = await createDraft(ctx, { number: 55, pos_number: 9, voucher_type: "B" });
    expect(invoice.number).toBeNull();
    expect(invoice.pos_number).toBe(3);
    expect(invoice.voucher_type).toBe("A");
  });

  it("rechaza un punto de venta manual, inactivo o inexistente", async () => {
    const ctx = await setup();
    const manual = await db.CompanyPointOfSale.create({ number: 2, type: "manual" });
    const inactive = await db.CompanyPointOfSale.create({ number: 4, type: "web_service", is_active: false });
    for (const id of [manual.id, inactive.id, 99999, null]) {
      const res = await as(ctx.actor).post("/invoices").send(draftBody(ctx, { point_of_sale_id: id }));
      expect(res.status).toBe(400);
    }
  });

  it("exige concepto y valida las fechas del período", async () => {
    const ctx = await setup();
    expect((await as(ctx.actor).post("/invoices").send(draftBody(ctx, { arca_concept: null }))).status).toBe(400);
    expect((await as(ctx.actor).post("/invoices").send(draftBody(ctx, { arca_concept: 2, service_from: "no-es-fecha" }))).status).toBe(400);
  });

  it("en dólares calcula el total en pesos con la cotización", async () => {
    const ctx = await setup();
    await ctx.budget.update({ currency: "USD" });
    const invoice = await createDraft(ctx, { currency: "USD", exchange_rate: 1500.5, same_currency_payment: true });
    expect(invoice.total_amount_ars).toBe(Math.round(invoice.total_amount * 1500.5 * 100) / 100);
    expect(invoice.same_currency_payment).toBe(true);
  });

  it("un sin_factura no se puede crear por ARCA: el borrador siempre es Factura A", async () => {
    const ctx = await setup({ permissions: ["invoices_read", "invoices_write", "invoices_unofficial"] });
    const invoice = await createDraft(ctx, { voucher_type: "sin_factura" });
    expect(invoice.voucher_type).toBe("A");
  });
});

describe("POST /invoices/:id/emit", () => {
  it("emite: reserva el número siguiente al último autorizado, guarda el CAE y congela emisor y receptor", async () => {
    const ctx = await setup();
    const draft = await createDraft(ctx);
    wsfe.getLastAuthorized.mockResolvedValue(41);
    wsfe.getVoucher.mockResolvedValue({ CbteFch: "20261101" });
    wsfe.requestCae.mockResolvedValue(approvedResponse(42));

    const res = await as(ctx.actor).post(`/invoices/${draft.id}/emit`).send({});
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ arca_status: "authorized", number: 42, cae: "76123456789012", cae_expiration: "2026-11-26", arca_env: "homologacion" });
    expect(res.body.data.issuer_snapshot).toMatchObject({ legal_name: "CONMOMET S.A", cuit: COMPANY_CUIT });
    expect(res.body.data.recipient_snapshot).toMatchObject({ cuit: CLIENT_CUIT, vat_condition_id: 1 });

    expect(wsfe.requestCae).toHaveBeenCalledTimes(1);
    const detail = wsfe.requestCae.mock.calls[0][0].FeCAEReq.FeDetReq.FECAEDetRequest[0];
    expect(detail).toMatchObject({ CbteDesde: 42, CbteHasta: 42, ImpNeto: 50000, ImpIVA: 10500, ImpTotal: 60500, MonId: "PES", CondicionIVAReceptorId: 1 });

    const audit = await db.AuditLog.findOne({ where: { entity_type: "Invoice", entity_id: draft.id, new_value: "authorized" } });
    expect(audit.performed_by).toBe(ctx.actor.user.id);
    expect(audit.context).toMatchObject({ env: "homologacion", number: 42, cae: "76123456789012" });
  });

  it("con el primer comprobante del punto de venta (último = 0) emite el número 1 sin consultar fechas", async () => {
    const ctx = await setup();
    const draft = await createDraft(ctx);
    wsfe.getLastAuthorized.mockResolvedValue(0);
    wsfe.requestCae.mockResolvedValue(approvedResponse(1));
    const res = await as(ctx.actor).post(`/invoices/${draft.id}/emit`).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.number).toBe(1);
    expect(wsfe.getVoucher).not.toHaveBeenCalled();
  });

  it("no emite con una fecha anterior a la del último comprobante, y la factura vuelve a borrador sin número", async () => {
    const ctx = await setup();
    const draft = await createDraft(ctx, { issue_date: TODAY });
    wsfe.getLastAuthorized.mockResolvedValue(5);
    wsfe.getVoucher.mockResolvedValue({ CbteFch: TODAY.replace(/-/g, "").replace(/.$/, "9") }); // fecha posterior
    const res = await as(ctx.actor).post(`/invoices/${draft.id}/emit`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/anterior a la del último comprobante/);
    expect(wsfe.requestCae).not.toHaveBeenCalled();
    expect(await reload(draft.id)).toMatchObject({ arca_status: "draft", number: null });
  });

  it("un doble clic emite una sola vez (el UPDATE condicional del borrador)", async () => {
    const ctx = await setup();
    const draft = await createDraft(ctx);
    wsfe.getLastAuthorized.mockResolvedValue(0);
    wsfe.requestCae.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(approvedResponse(1)), 150)));

    const [a, b] = await Promise.all([
      as(ctx.actor).post(`/invoices/${draft.id}/emit`).send({}),
      as(ctx.actor).post(`/invoices/${draft.id}/emit`).send({}),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(wsfe.requestCae).toHaveBeenCalledTimes(1);
    expect(await db.Invoice.count({ where: { arca_status: "authorized" } })).toBe(1);
  });

  it("dos facturas del mismo punto de venta y tipo no reservan el mismo número", async () => {
    const ctx = await setup();
    const first = await createDraft(ctx, { lines: [{ concept: "labor", percent: 30 }] });
    const second = await createDraft(ctx, { lines: [{ concept: "labor", percent: 30 }] });
    let last = 0;
    wsfe.getLastAuthorized.mockImplementation(async () => last);
    wsfe.getVoucher.mockResolvedValue({ CbteFch: "20200101" });
    wsfe.requestCae.mockImplementation(async (req) => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      const n = req.FeCAEReq.FeDetReq.FECAEDetRequest[0].CbteDesde;
      last = n;
      return approvedResponse(n);
    });

    const results = await Promise.all([
      as(ctx.actor).post(`/invoices/${first.id}/emit`).send({}),
      as(ctx.actor).post(`/invoices/${second.id}/emit`).send({}),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const numbers = (await db.Invoice.findAll({ where: { arca_status: "authorized" } })).map((i) => i.number).sort();
    expect(numbers).toEqual([1, 2]);
  });

  it("un rechazo de negocio de ARCA deja la factura rechazada, sin número y con el motivo, sin credenciales", async () => {
    const ctx = await setup();
    const draft = await createDraft(ctx);
    wsfe.getLastAuthorized.mockResolvedValue(0);
    wsfe.requestCae.mockRejectedValue(new ArcaError("afip", "ARCA rechazó la factura: (10016) Fecha inválida", { details: { codes: [10016] } }));

    const res = await as(ctx.actor).post(`/invoices/${draft.id}/emit`).send({});
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/10016/);
    const invoice = await reload(draft.id);
    expect(invoice).toMatchObject({ arca_status: "rejected", number: null });
    expect(JSON.stringify(invoice.arca_result)).not.toMatch(/Token|Sign/i);
  });

  it("un Resultado R con observaciones también la deja rechazada", async () => {
    const ctx = await setup();
    const draft = await createDraft(ctx);
    wsfe.getLastAuthorized.mockResolvedValue(0);
    wsfe.requestCae.mockResolvedValue({
      FeCabResp: { Resultado: "R" },
      FeDetResp: { FECAEDetResponse: { Resultado: "R", Observaciones: { Obs: [{ Code: 10063, Msg: "Receptor inválido" }] } } },
    });
    const res = await as(ctx.actor).post(`/invoices/${draft.id}/emit`).send({});
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/10063/);
    expect(await reload(draft.id)).toMatchObject({ arca_status: "rejected", number: null });
  });

  it("una rechazada se puede corregir (vuelve a borrador) y volver a emitir", async () => {
    const ctx = await setup();
    const draft = await createDraft(ctx);
    wsfe.getLastAuthorized.mockResolvedValue(0);
    wsfe.requestCae.mockRejectedValueOnce(new ArcaError("afip", "ARCA rechazó la factura: (1) x", { details: { codes: [1] } }));
    await as(ctx.actor).post(`/invoices/${draft.id}/emit`).send({});

    const edit = await as(ctx.actor).put(`/invoices/${draft.id}`).send(draftBody(ctx, { lines: [{ concept: "labor", percent: 40 }] }));
    expect(edit.status).toBe(200);
    expect(edit.body.data.arca_status).toBe("draft");

    wsfe.requestCae.mockResolvedValue(approvedResponse(1));
    expect((await as(ctx.actor).post(`/invoices/${draft.id}/emit`).send({})).status).toBe(200);
  });

  it("si ARCA no responde, la factura queda 'autorizando' con su número y bloquea las siguientes del mismo punto de venta", async () => {
    const ctx = await setup();
    const first = await createDraft(ctx, { lines: [{ concept: "labor", percent: 30 }] });
    const second = await createDraft(ctx, { lines: [{ concept: "labor", percent: 30 }] });
    wsfe.getLastAuthorized.mockResolvedValue(0);
    wsfe.requestCae.mockRejectedValue(new ArcaError("network", "ARCA no respondió a tiempo (30 s)."));

    const res = await as(ctx.actor).post(`/invoices/${first.id}/emit`).send({});
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/Verificar en ARCA/);
    expect(await reload(first.id)).toMatchObject({ arca_status: "authorizing", number: 1 });

    const blocked = await as(ctx.actor).post(`/invoices/${second.id}/emit`).send({});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/sin resolver/);
    expect(await reload(second.id)).toMatchObject({ arca_status: "draft", number: null });
    expect(wsfe.requestCae).toHaveBeenCalledTimes(1);
  });

  it("no emite una factura que no es borrador, ni una de otro origen", async () => {
    const ctx = await setup();
    const draft = await createDraft(ctx);
    wsfe.getLastAuthorized.mockResolvedValue(0);
    wsfe.requestCae.mockResolvedValue(approvedResponse(1));
    await as(ctx.actor).post(`/invoices/${draft.id}/emit`).send({});
    expect((await as(ctx.actor).post(`/invoices/${draft.id}/emit`).send({})).status).toBe(409);

    const budget2 = await createBudget({ clientId: ctx.client.id, createdBy: ctx.actor.user.id, status: "approved" });
    const itemType = await createBudgetItemType();
    await db.BudgetLaborLine.create({ budget_id: budget2.id, budget_item_type_id: itemType.id, quantity: 1, unit_price: 1000, estimated_total: 1000 });
    const manual = await as(ctx.actor).post("/invoices").send({
      voucher_type: "A", pos_number: 2, number: 10, issue_date: TODAY, currency: "ARS", budget_id: budget2.id, iva_rate: 21, lines: [{ concept: "labor", percent: 50 }],
    });
    expect(manual.status).toBe(201);
    expect((await as(ctx.actor).post(`/invoices/${manual.body.data.id}/emit`).send({})).status).toBe(404);
  });

  it("frena antes de llamar a ARCA lo que ARCA rechazaría (cliente sin CUIT, empresa incompleta, integración apagada)", async () => {
    const ctx = await setup({ clientOverrides: { cuit: null } });
    const draft = await createDraft(ctx);
    const noCuit = await as(ctx.actor).post(`/invoices/${draft.id}/emit`).send({});
    expect(noCuit.status).toBe(400);
    expect(noCuit.body.error).toMatch(/CUIT/);
    expect(wsfe.getLastAuthorized).not.toHaveBeenCalled();
    expect(await reload(draft.id)).toMatchObject({ arca_status: "draft" });

    await ctx.client.update({ cuit: CLIENT_CUIT });
    await db.Invoice.update({ recipient_doc_number: CLIENT_CUIT }, { where: { id: draft.id } });
    await db.CompanyProfile.update({ address_street: null }, { where: { id: 1 } });
    expect((await as(ctx.actor).post(`/invoices/${draft.id}/emit`).send({})).body.error).toMatch(/domicilio comercial/);

    delete process.env.ARCA_ENV;
    const off = await as(ctx.actor).post(`/invoices/${draft.id}/emit`).send({});
    expect(off.status).toBe(409);
    expect(off.body.error).toMatch(/apagada/);
  });

  it("en producción no emite si el CUIT de la conexión no es el de la empresa", async () => {
    const ctx = await setup();
    const draft = await createDraft(ctx);
    process.env.ARCA_ENV = "produccion";
    process.env.ARCA_CUIT = CLIENT_CUIT;
    const res = await as(ctx.actor).post(`/invoices/${draft.id}/emit`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no coincide/);
    expect(wsfe.requestCae).not.toHaveBeenCalled();
  });
});

describe("POST /invoices/:id/verify", () => {
  async function authorizingInvoice(ctx) {
    const draft = await createDraft(ctx);
    wsfe.getLastAuthorized.mockResolvedValue(0);
    wsfe.requestCae.mockRejectedValueOnce(new ArcaError("network", "timeout"));
    await as(ctx.actor).post(`/invoices/${draft.id}/emit`).send({});
    return draft;
  }
  const voucherFor = (draft, over = {}) => ({
    ImpTotal: draft.total_amount, DocNro: CLIENT_CUIT, CbteFch: TODAY.replace(/-/g, ""), CodAutorizacion: "76123456789012", FchVto: "20261126", Resultado: "A", ...over,
  });

  it("si ARCA tiene el comprobante y coincide, completa la factura sin duplicarla", async () => {
    const ctx = await setup();
    const draft = await authorizingInvoice(ctx);
    wsfe.getVoucher.mockResolvedValue(voucherFor(draft));
    const res = await as(ctx.actor).post(`/invoices/${draft.id}/verify`).send({});
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("authorized");
    expect(res.body.data).toMatchObject({ arca_status: "authorized", number: 1, cae: "76123456789012", cae_expiration: "2026-11-26" });
    expect(wsfe.requestCae).toHaveBeenCalledTimes(1);
  });

  it("si ARCA no lo tiene, vuelve a borrador sin número", async () => {
    const ctx = await setup();
    const draft = await authorizingInvoice(ctx);
    wsfe.getVoucher.mockResolvedValue(null);
    const res = await as(ctx.actor).post(`/invoices/${draft.id}/verify`).send({});
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("back_to_draft");
    expect(await reload(draft.id)).toMatchObject({ arca_status: "draft", number: null });
  });

  it("si existe un comprobante con ese número pero otros datos, no completa nada", async () => {
    const ctx = await setup();
    const draft = await authorizingInvoice(ctx);
    for (const over of [{ ImpTotal: 1 }, { DocNro: "20000000001" }, { CbteFch: "20200101" }, { CodAutorizacion: "" }]) {
      wsfe.getVoucher.mockResolvedValue(voucherFor(draft, over));
      const res = await as(ctx.actor).post(`/invoices/${draft.id}/verify`).send({});
      expect(res.status).toBe(409);
      expect(await reload(draft.id)).toMatchObject({ arca_status: "authorizing", number: 1, cae: null });
    }
  });

  it("solo verifica facturas 'autorizando' y de este ambiente", async () => {
    const ctx = await setup();
    const draft = await createDraft(ctx);
    expect((await as(ctx.actor).post(`/invoices/${draft.id}/verify`).send({})).status).toBe(409);

    const stuck = await authorizingInvoice(ctx);
    await db.Invoice.update({ arca_env: "produccion" }, { where: { id: stuck.id } });
    const res = await as(ctx.actor).post(`/invoices/${stuck.id}/verify`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/produccion/);
  });
});

describe("permisos de emisión (S3)", () => {
  it("sin invoices_emit no puede emitir ni verificar, aunque tenga invoices_write", async () => {
    const ctx = await setup({ permissions: ["invoices_read", "invoices_write", "invoices_update"] });
    const draft = await createDraft(ctx);
    expect((await as(ctx.actor).post(`/invoices/${draft.id}/emit`).send({})).status).toBe(401);
    expect((await as(ctx.actor).post(`/invoices/${draft.id}/verify`).send({})).status).toBe(401);
    expect(wsfe.getLastAuthorized).not.toHaveBeenCalled();
  });

  it("con invoices_emit pero sin invoices_write tampoco (hace falta la ruta)", async () => {
    const ctx = await setup();
    const draft = await createDraft(ctx);
    const emitOnly = await createActor({ permissions: ["invoices_emit"] });
    expect((await as(emitOnly).post(`/invoices/${draft.id}/emit`).send({})).status).toBe(401);
  });

  it("con admin_granted (bypass) puede emitir", async () => {
    const ctx = await setup();
    const draft = await createDraft(ctx);
    const admin = await createActor({ role: "admin" });
    wsfe.getLastAuthorized.mockResolvedValue(0);
    wsfe.requestCae.mockResolvedValue(approvedResponse(1));
    expect((await as(admin).post(`/invoices/${draft.id}/emit`).send({})).status).toBe(200);
  });
});

describe("bloqueos de edición y anulación (B4) y descartar (B8)", () => {
  async function authorizedInvoice(ctx) {
    const draft = await createDraft(ctx);
    wsfe.getLastAuthorized.mockResolvedValue(0);
    wsfe.requestCae.mockResolvedValue(approvedResponse(1));
    await as(ctx.actor).post(`/invoices/${draft.id}/emit`).send({});
    return draft;
  }

  it("una factura emitida no se edita ni se anula por la ruta vieja, ni con invoices_correct", async () => {
    const ctx = await setup({ permissions: ["invoices_read", "invoices_write", "invoices_update", "invoices_emit", "invoices_correct"] });
    const invoice = await authorizedInvoice(ctx);
    const edit = await as(ctx.actor).put(`/invoices/${invoice.id}`).send(draftBody(ctx));
    expect(edit.status).toBe(409);
    expect(edit.body.error).toMatch(/no se puede editar/);
    const cancel = await as(ctx.actor).put(`/invoices/${invoice.id}/cancel`).send({ reason: "x" });
    expect(cancel.status).toBe(409);
    expect(await reload(invoice.id)).toMatchObject({ status: "pending", arca_status: "authorized", cae: "76123456789012" });
  });

  it("una 'autorizando' tampoco se edita, anula ni descarta", async () => {
    const ctx = await setup();
    const draft = await createDraft(ctx);
    wsfe.getLastAuthorized.mockResolvedValue(0);
    wsfe.requestCae.mockRejectedValue(new ArcaError("network", "timeout"));
    await as(ctx.actor).post(`/invoices/${draft.id}/emit`).send({});
    expect((await as(ctx.actor).put(`/invoices/${draft.id}`).send(draftBody(ctx))).status).toBe(409);
    expect((await as(ctx.actor).put(`/invoices/${draft.id}/cancel`).send({ reason: "x" })).status).toBe(409);
    expect((await as(ctx.actor).put(`/invoices/${draft.id}/discard`).send({})).status).toBe(409);
  });

  it("un borrador se edita con invoices_update, sin invoices_correct", async () => {
    const ctx = await setup();
    const draft = await createDraft(ctx);
    const res = await as(ctx.actor).put(`/invoices/${draft.id}`).send(draftBody(ctx, { lines: [{ concept: "labor", percent: 20 }] }));
    expect(res.status).toBe(200);
    expect(res.body.data.net_amount).toBe(20000);
  });

  it("no se puede cobrar una factura que no fue emitida", async () => {
    const ctx = await setup();
    const draft = await createDraft(ctx);
    expect((await as(ctx.actor).put(`/invoices/${draft.id}/pay`).send({ paid_at: TODAY })).status).toBe(409);
  });

  it("una emitida sí se puede marcar como cobrada", async () => {
    const ctx = await setup();
    const invoice = await authorizedInvoice(ctx);
    const res = await as(ctx.actor).put(`/invoices/${invoice.id}/pay`).send({ paid_at: TODAY });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("paid");
  });

  it("descartar un borrador libera el saldo, sin nota de crédito", async () => {
    const ctx = await setup();
    const first = await createDraft(ctx, { lines: [{ concept: "labor", percent: 100 }] });
    const blocked = await as(ctx.actor).post("/invoices").send(draftBody(ctx, { lines: [{ concept: "labor", percent: 100 }] }));
    expect(blocked.status).toBe(400); // el borrador ocupa el saldo

    const discard = await as(ctx.actor).put(`/invoices/${first.id}/discard`).send({});
    expect(discard.status).toBe(200);
    expect(discard.body.data).toMatchObject({ status: "cancelled" });
    const again = await as(ctx.actor).post("/invoices").send(draftBody(ctx, { lines: [{ concept: "labor", percent: 100 }] }));
    expect(again.status).toBe(201);
  });

  it("no se puede descartar una factura emitida", async () => {
    const ctx = await setup();
    const invoice = await authorizedInvoice(ctx);
    expect((await as(ctx.actor).put(`/invoices/${invoice.id}/discard`).send({})).status).toBe(409);
  });
});

describe("GET /invoices/arca/options y /exchange-rate", () => {
  it("devuelve los puntos de venta de web service activos y avisa qué falta de la empresa", async () => {
    const ctx = await setup();
    await db.CompanyPointOfSale.create({ number: 2, type: "manual" });
    await db.CompanyPointOfSale.create({ number: 5, type: "web_service", is_active: false });
    await db.CompanyProfile.update({ address_locality: null }, { where: { id: 1 } });
    const res = await as(ctx.actor).get("/invoices/arca/options");
    expect(res.status).toBe(200);
    expect(res.body.data.enabled).toBe(true);
    expect(res.body.data.env).toBe("homologacion");
    expect(res.body.data.points_of_sale.map((p) => p.number)).toEqual([3]);
    expect(res.body.data.issuer_missing).toEqual(["domicilio comercial"]);
    expect(res.body.data.receiver_vat_conditions.map((c) => c.id)).toEqual([1, 6, 13, 16]);
  });

  it("la cotización viene de ARCA; si la integración falla responde un error legible", async () => {
    const ctx = await setup();
    wsfe.getExchangeRate.mockResolvedValue({ currency: "DOL", rate: 1543.5, date: "20261113" });
    const ok = await as(ctx.actor).get("/invoices/arca/exchange-rate");
    expect(ok.body.data).toEqual({ rate: 1543.5, date: "20261113" });

    wsfe.getExchangeRate.mockRejectedValue(new ArcaError("network", "ARCA no respondió"));
    const fail = await as(ctx.actor).get("/invoices/arca/exchange-rate");
    expect(fail.status).toBe(502);
    expect(fail.body.error).toMatch(/no respondió/);
  });

  it("exige invoices_read", async () => {
    const actor = await createActor({ permissions: ["system_settings_update"] });
    expect((await as(actor).get("/invoices/arca/options")).status).toBe(401);
  });
});

describe("carga manual: clave única por tipo de comprobante (B1)", () => {
  const manualBody = (ctx, overrides) => ({
    voucher_type: "A", pos_number: 2, number: 212, issue_date: TODAY, currency: "ARS", budget_id: ctx.budget.id, iva_rate: 21,
    lines: [{ concept: "labor", percent: 10 }], ...overrides,
  });

  it("una Factura A y una FCE A con el mismo punto de venta y número conviven", async () => {
    const ctx = await setup();
    const factura = await as(ctx.actor).post("/invoices").send(manualBody(ctx, {}));
    const fce = await as(ctx.actor).post("/invoices").send(manualBody(ctx, { cbte_tipo: 201 }));
    expect(factura.status).toBe(201);
    expect(factura.body.data.cbte_tipo).toBe(1);
    expect(fce.status).toBe(201);
    expect(fce.body.data.cbte_tipo).toBe(201);
  });

  it("repetir el mismo tipo, punto de venta y número se rechaza con el nombre del comprobante", async () => {
    const ctx = await setup();
    await as(ctx.actor).post("/invoices").send(manualBody(ctx, { cbte_tipo: 201 }));
    const dup = await as(ctx.actor).post("/invoices").send(manualBody(ctx, { cbte_tipo: 201 }));
    expect(dup.status).toBe(400);
    expect(dup.body.error).toMatch(/Factura de Crédito Electrónica A 0002-00000212/);
  });

  it("un tipo que no corresponde a la letra se rechaza", async () => {
    const ctx = await setup();
    const res = await as(ctx.actor).post("/invoices").send(manualBody(ctx, { cbte_tipo: 6 }));
    expect(res.status).toBe(400);
  });

  it("un sin_factura queda sin cbte_tipo y no choca con otros", async () => {
    const ctx = await setup({ permissions: ["invoices_read", "invoices_write", "invoices_unofficial"] });
    const body = { voucher_type: "sin_factura", issue_date: TODAY, currency: "ARS", budget_id: ctx.budget.id, lines: [{ concept: "labor", percent: 10 }] };
    const a = await as(ctx.actor).post("/invoices").send(body);
    const b = await as(ctx.actor).post("/invoices").send(body);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.data.cbte_tipo).toBeNull();
  });
});
