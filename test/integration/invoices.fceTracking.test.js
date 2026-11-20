"use strict";
// Seguimiento de FCE con ARCA (wsfecred, FLOWS.md §77). ARCA (wsfe y wsfecred) y R2 simulados.
jest.mock("../../services/arca/wsfe", () => ({
  dummy: jest.fn(), getPointsOfSale: jest.fn(), getLastAuthorized: jest.fn(), getVoucher: jest.fn(), requestCae: jest.fn(), getExchangeRate: jest.fn(),
}));
jest.mock("../../services/arca/wsfecred", () => ({
  dummy: jest.fn(), getFecredAuth: jest.fn(), consultarComprobantes: jest.fn(), consultarCtasCtes: jest.fn(),
  consultarHistorialEstadosComprobante: jest.fn(), consultarHistorialEstadosCtaCte: jest.fn(),
}));
jest.mock("../../services/arca/wsaa", () => ({ getAuth: jest.fn() }));
jest.mock("../../services/arca/credentials", () => ({
  ...jest.requireActual("../../services/arca/credentials"),
  describeCertificate: jest.fn(() => ({ subject: "test" })),
}));
jest.mock("../../helpers/r2Storage", () => ({
  ...jest.requireActual("../../helpers/r2Storage"),
  uploadToR2: jest.fn(async (file, folder) => `https://files.test/${folder}/${file.originalname}`),
  deleteFromR2: jest.fn(async () => {}),
}));

const db = require("../../models");
const wsfecred = require("../../services/arca/wsfecred");
const wsfe = require("../../services/arca/wsfe");
const wsaa = require("../../services/arca/wsaa");
const arca = require("../../services/arca");
const { ArcaError } = require("../../services/arca/errors");
const { createActor, as } = require("../helpers/auth");
const { createClient } = require("../factories/budget");

const COMPANY_CUIT = "20123456786";

let savedEnv;
beforeAll(() => { savedEnv = { env: process.env.ARCA_ENV, cuit: process.env.ARCA_CUIT }; });
afterAll(() => {
  for (const [key, value] of [["ARCA_ENV", savedEnv.env], ["ARCA_CUIT", savedEnv.cuit]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

beforeEach(async () => {
  jest.clearAllMocks();
  process.env.ARCA_ENV = "homologacion";
  process.env.ARCA_CUIT = COMPANY_CUIT;
  await db.SystemSetting.update({ last_fce_sync_at: null }, { where: { id: 1 } });
  wsfecred.consultarComprobantes.mockResolvedValue({ items: [], truncated: false });
  wsfecred.consultarCtasCtes.mockResolvedValue({ items: [], truncated: false });
});

let counter = 0;
async function setup({ permissions = ["invoices_read", "invoices_write"] } = {}) {
  const actor = await createActor({ permissions });
  const client = await createClient({ cuit: "30716396653" });
  return { actor, client };
}

// Factura FCE ya emitida por ARCA, como la deja la emisión (pendiente de aceptación).
async function fce(ctx, over = {}) {
  counter += 1;
  return db.Invoice.create({
    voucher_type: "A", cbte_tipo: 201, pos_number: 3, number: counter, issue_date: "2026-11-10", due_date: "2026-12-10", client_id: ctx.client.id, currency: "ARS",
    net_amount: 100000, iva_rate: 21, iva_amount: 21000, total_amount: 121000, source: "arca", arca_status: "authorized", arca_env: "homologacion", cae: "76123456789012",
    fce_transfer_option: "SCA", fce_acceptance: "pending", created_by: ctx.actor.user.id, ...over,
  });
}
// Lo que devuelve wsfecred.mapComprobante / mapCtaCte para esa factura.
const cmp = (inv, over = {}) => ({
  cbte_tipo: inv.cbte_tipo, pos_number: inv.pos_number, number: inv.number, recipient_cuit: "30716396653", cmp_state: "Recepcionado", cmp_state_at: new Date(), account_code: 9000 + inv.number,
  acceptance_type: null, accepted_at: null, available_at: "2026-11-11", acceptance_due: "2026-11-21", payment_due: "2026-12-10", rejection_reasons: [], transfer_option: null,
  is_annulment: null, associated: null, total: 121000, currency: "PES", snapshot: { codCtaCte: 9000 + inv.number, CBUEmisor: "******************7370" }, ...over,
});
const cta = (inv, over = {}) => ({
  account_code: 9000 + inv.number, account_state: "Modificable", account_state_at: new Date(), cbte_tipo: inv.cbte_tipo, pos_number: inv.pos_number, number: inv.number,
  total: 121000, balance: 121000, accepted_balance: null, currency: "PES", transfer_option: null, ...over,
});
const arcaReturns = (comprobantes, cuentas = []) => {
  wsfecred.consultarComprobantes.mockResolvedValue({ items: comprobantes, truncated: false });
  wsfecred.consultarCtasCtes.mockResolvedValue({ items: cuentas, truncated: false });
};
const syncAll = (ctx) => as(ctx.actor).post("/invoices/fce/sync").send({});

describe("POST /invoices/fce/sync", () => {
  it("empareja por tipo, punto de venta y número, guarda los estados de ARCA y deriva la aceptación", async () => {
    const ctx = await setup();
    const pending = await fce(ctx);
    const accepted = await fce(ctx);
    const rejected = await fce(ctx);
    arcaReturns(
      [
        cmp(pending),
        cmp(accepted, { cmp_state: "Aceptado", acceptance_type: "Tacita", accepted_at: new Date("2026-11-22T03:00:00Z") }),
        cmp(rejected, { cmp_state: "Rechazado", accepted_at: new Date("2026-11-15T15:00:00Z"), rejection_reasons: [{ code: 3, description: "Importe erróneo", justification: "No coincide con la OC" }] }),
      ],
      [cta(pending), cta(accepted, { account_state: "Aceptada", balance: 121000, accepted_balance: 121000 }), cta(rejected, { account_state: "Rechazada", balance: 0 })]
    );

    const res = await syncAll(ctx);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ checked: 3, updated: 3, truncated: false, not_found_in_arca: [], only_in_arca: [] });

    const [p, a, r] = await Promise.all([pending, accepted, rejected].map((i) => db.Invoice.findByPk(i.id)));
    expect(p).toMatchObject({ fce_cmp_state: "Recepcionado", fce_account_state: "Modificable", fce_acceptance: "pending", fce_acceptance_at: null, fce_acceptance_due: "2026-11-21" });
    expect(Number(p.fce_account_code)).toBe(9000 + pending.number);
    expect(a).toMatchObject({ fce_cmp_state: "Aceptado", fce_account_state: "Aceptada", fce_acceptance: "accepted", fce_acceptance_type: "Tacita" });
    expect(a.fce_acceptance_at).toBeTruthy();
    expect(Number(a.fce_accepted_balance)).toBe(121000);
    expect(r).toMatchObject({ fce_cmp_state: "Rechazado", fce_account_state: "Rechazada", fce_acceptance: "rejected" });
    expect(r.fce_rejection_reasons).toEqual([{ code: 3, description: "Importe erróneo", justification: "No coincide con la OC" }]);
    expect(r.fce_synced_at).toBeTruthy();
    expect(r.fce_arca_snapshot).toMatchObject({ CBUEmisor: "******************7370" });
  });

  it("pisa lo que se hubiera cargado a mano antes", async () => {
    const ctx = await setup();
    const inv = await fce(ctx, { fce_acceptance: "accepted", fce_acceptance_at: new Date() });
    arcaReturns([cmp(inv)], [cta(inv)]);
    await syncAll(ctx);
    expect(await db.Invoice.findByPk(inv.id)).toMatchObject({ fce_acceptance: "pending", fce_acceptance_at: null });
  });

  it("audita cada cambio de estado con el usuario que sincronizó, y no vuelve a auditar si no cambió nada", async () => {
    const ctx = await setup();
    const inv = await fce(ctx);
    arcaReturns([cmp(inv)], [cta(inv)]);
    await syncAll(ctx);
    const audit = await db.AuditLog.findAll({ where: { entity_type: "Invoice", entity_id: inv.id }, order: [["id", "ASC"]] });
    expect(audit.map((a) => [a.field_changed, a.previous_value, a.new_value])).toEqual([["fce_cmp_state", null, "Recepcionado"], ["fce_account_state", null, "Modificable"]]);
    expect(audit[0].performed_by).toBe(ctx.actor.user.id);

    await db.SystemSetting.update({ last_fce_sync_at: null }, { where: { id: 1 } });
    const again = await syncAll(ctx);
    expect(again.body.data).toMatchObject({ checked: 1, updated: 0, changes: [] });
    expect(await db.AuditLog.count({ where: { entity_type: "Invoice", entity_id: inv.id } })).toBe(2);
  });

  it("la opción de transferencia vigente de ARCA reemplaza a la nuestra y queda auditada", async () => {
    const ctx = await setup();
    const inv = await fce(ctx, { fce_transfer_option: "SCA" });
    arcaReturns([cmp(inv)], [cta(inv, { transfer_option: "ADC" })]);
    await syncAll(ctx);
    expect((await db.Invoice.findByPk(inv.id)).fce_transfer_option).toBe("ADC");
    expect(await db.AuditLog.count({ where: { entity_id: inv.id, field_changed: "fce_transfer_option", new_value: "ADC" } })).toBe(1);
  });

  it("una factura que ARCA no devuelve no se toca y se informa", async () => {
    const ctx = await setup();
    const known = await fce(ctx);
    const missing = await fce(ctx, { fce_cmp_state: "Recepcionado", fce_account_state: "Modificable" });
    arcaReturns([cmp(known)], [cta(known)]);
    const res = await syncAll(ctx);
    expect(res.body.data.not_found_in_arca).toEqual([expect.objectContaining({ invoice_id: missing.id })]);
    const after = await db.Invoice.findByPk(missing.id);
    expect(after.fce_synced_at).toBeNull();
    expect(after.fce_cmp_state).toBe("Recepcionado");
  });

  it("lo que ARCA devuelve y no está en la app se lista aparte sin importarse", async () => {
    const ctx = await setup();
    const inv = await fce(ctx);
    const foreign = { ...cmp(inv), number: 777, account_code: 1 };
    arcaReturns([cmp(inv), foreign], [cta(inv)]);
    const res = await syncAll(ctx);
    expect(res.body.data.only_in_arca).toEqual([expect.objectContaining({ label: expect.stringContaining("0003-00000777"), state: "Recepcionado" })]);
    expect(await db.Invoice.count({ where: { number: 777 } })).toBe(0);
  });

  it("no consulta las que ya están en estado final y arma el rango desde la más vieja que todavía puede cambiar", async () => {
    const ctx = await setup();
    await fce(ctx, { issue_date: "2026-01-05", fce_account_state: "Rechazada", fce_cmp_state: "Rechazado" });
    await fce(ctx, { issue_date: "2026-02-05", fce_account_state: "Aceptada", fce_cmp_state: "Aceptado", fce_transfer_option: "SCA" });
    const open = await fce(ctx, { issue_date: "2026-11-03" });
    await fce(ctx, { issue_date: "2026-10-01", fce_account_state: "Aceptada", fce_cmp_state: "Aceptado", fce_transfer_option: "ADC" });
    arcaReturns([cmp(open)], [cta(open)]);
    const res = await syncAll(ctx);
    // Cuenta Rechazada y Aceptada con SCA no cambian más; Aceptada con ADC todavía puede pasar a Informada.
    expect(res.body.data.checked).toBe(2);
    expect(wsfecred.consultarComprobantes.mock.calls[0][0].fecha).toMatchObject({ tipo: "Emision", desde: "2026-10-01" });
  });

  it("sin nada para seguir no llama a ARCA", async () => {
    const ctx = await setup();
    await fce(ctx, { fce_account_state: "CanceladaTotal" });
    const res = await syncAll(ctx);
    expect(res.body.data).toMatchObject({ checked: 0, updated: 0 });
    expect(wsfecred.consultarComprobantes).not.toHaveBeenCalled();
  });

  it("ignora las facturas de otro ambiente, las anuladas, las manuales y las que no son FCE", async () => {
    const ctx = await setup();
    await fce(ctx, { arca_env: "produccion" });
    await fce(ctx, { status: "cancelled" });
    await fce(ctx, { source: "manual", arca_status: "manual", cbte_tipo: null });
    await fce(ctx, { cbte_tipo: 1 });
    const res = await syncAll(ctx);
    expect(res.body.data.checked).toBe(0);
  });

  it("si el comprobante es una nota de crédito rechazada, solo guarda el estado del comprobante", async () => {
    const ctx = await setup();
    const original = await fce(ctx, { fce_account_state: "Modificable", fce_cmp_state: "Recepcionado" });
    const note = await fce(ctx, { cbte_tipo: 203, kind: "credit_note", associated_invoice_id: original.id });
    arcaReturns([cmp(original), cmp(note, { cmp_state: "Rechazado" })], [cta(original)]);
    await syncAll(ctx);
    expect(await db.Invoice.findByPk(note.id)).toMatchObject({ fce_cmp_state: "Rechazado", fce_acceptance: "pending", fce_account_state: null });
  });

  it("dos sincronizaciones seguidas: la segunda recibe 409", async () => {
    const ctx = await setup();
    const inv = await fce(ctx);
    arcaReturns([cmp(inv)], [cta(inv)]);
    expect((await syncAll(ctx)).status).toBe(200);
    const second = await syncAll(ctx);
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/Ya hay una sincronización/);
  });

  it("si ARCA falla devuelve el error legible y deja libre el turno para reintentar", async () => {
    const ctx = await setup();
    await fce(ctx);
    wsfecred.consultarComprobantes.mockRejectedValueOnce(new ArcaError("afip", "No se pudieron consultar las FCE en ARCA: (1100) No autorizado. Autorizá wsfecred."));
    const res = await syncAll(ctx);
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/Autorizá wsfecred/);
    expect((await db.SystemSetting.findByPk(1)).last_fce_sync_at).toBeNull();
    expect((await syncAll(ctx)).status).toBe(200);
  });

  it("con la integración apagada responde 409", async () => {
    const ctx = await setup();
    delete process.env.ARCA_ENV;
    expect((await syncAll(ctx)).status).toBe(409);
  });

  it("exige invoices_write; con invoices_read solo ve, y con admin_granted también anda", async () => {
    const ctx = await setup({ permissions: ["invoices_read"] });
    expect((await syncAll(ctx)).status).toBe(401);
    expect((await as(ctx.actor).get("/invoices/fce")).status).toBe(200);
    const none = await createActor({ permissions: [] });
    expect((await as(none).get("/invoices/fce")).status).toBe(401);
    const admin = await createActor({ role: "admin" });
    expect((await as(admin).post("/invoices/fce/sync").send({})).status).toBe(200);
  });
});

describe("POST /invoices/:id/fce/sync", () => {
  it("sincroniza una factura y sus notas por la cuenta corriente, sin tomar el turno general", async () => {
    const ctx = await setup();
    const inv = await fce(ctx, { fce_account_code: 4242 });
    const note = await fce(ctx, { cbte_tipo: 202, kind: "debit_note", associated_invoice_id: inv.id });
    const other = await fce(ctx);
    arcaReturns([cmp(inv, { account_code: 4242 }), cmp(note, { account_code: 4242 })], [cta(inv, { account_code: 4242, account_state: "Aceptada", accepted_balance: 100 })]);
    const res = await as(ctx.actor).post(`/invoices/${inv.id}/fce/sync`).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.checked).toBe(2);
    expect(wsfecred.consultarComprobantes.mock.calls[0][0]).toMatchObject({ codCtaCte: 4242, fecha: { desde: "2026-11-10" } });
    expect(await db.Invoice.findByPk(inv.id)).toMatchObject({ fce_account_state: "Aceptada", fce_acceptance: "accepted" });
    expect((await db.Invoice.findByPk(note.id)).fce_cmp_state).toBe("Recepcionado");
    expect((await db.Invoice.findByPk(other.id)).fce_synced_at).toBeNull();
    expect((await db.SystemSetting.findByPk(1)).last_fce_sync_at).toBeNull();
  });

  it("rechaza lo que no es una FCE emitida por ARCA y responde 404 si no existe", async () => {
    const ctx = await setup();
    const factura = await fce(ctx, { cbte_tipo: 1 });
    expect((await as(ctx.actor).post(`/invoices/${factura.id}/fce/sync`).send({})).status).toBe(409);
    expect((await as(ctx.actor).post("/invoices/99999/fce/sync").send({})).status).toBe(404);
  });

  it("exige invoices_write", async () => {
    const ctx = await setup({ permissions: ["invoices_read"] });
    const inv = await fce(ctx);
    expect((await as(ctx.actor).post(`/invoices/${inv.id}/fce/sync`).send({})).status).toBe(401);
  });
});

describe("GET /invoices/:id/fce/history", () => {
  it("trae de ARCA el historial del comprobante y de su cuenta corriente, cada uno por separado", async () => {
    const ctx = await setup();
    const inv = await fce(ctx, { fce_account_code: 4242 });
    wsfecred.consultarHistorialEstadosComprobante.mockResolvedValue([{ state: "PendienteRecepcion", at: new Date() }, { state: "Recepcionado", at: new Date() }]);
    wsfecred.consultarHistorialEstadosCtaCte.mockRejectedValue(new ArcaError("afip", "falló la cuenta corriente"));
    const res = await as(ctx.actor).get(`/invoices/${inv.id}/fce/history`);
    expect(res.status).toBe(200);
    expect(res.body.data.comprobante.items.map((e) => e.state)).toEqual(["PendienteRecepcion", "Recepcionado"]);
    expect(res.body.data.cuenta_corriente).toMatchObject({ ok: false, error: "falló la cuenta corriente" });
    expect(wsfecred.consultarHistorialEstadosComprobante).toHaveBeenCalledWith({ cuitEmisor: COMPANY_CUIT, cbteTipo: 201, posNumber: 3, number: inv.number });
    expect(wsfecred.consultarHistorialEstadosCtaCte).toHaveBeenCalledWith(4242);
  });

  it("una factura sin cuenta corriente conocida solo trae el historial del comprobante", async () => {
    const ctx = await setup();
    const inv = await fce(ctx);
    wsfecred.consultarHistorialEstadosComprobante.mockResolvedValue([]);
    const res = await as(ctx.actor).get(`/invoices/${inv.id}/fce/history`);
    expect(res.body.data.cuenta_corriente).toBeNull();
  });

  it("exige invoices_read", async () => {
    const none = await createActor({ permissions: [] });
    expect((await as(none).get("/invoices/1/fce/history")).status).toBe(401);
  });
});

describe("GET /invoices/fce", () => {
  it("lista las FCE con su seguimiento, cliente y notas, y cuenta por grupo", async () => {
    const ctx = await setup();
    const pending = await fce(ctx, { issue_date: "2026-11-12", fce_cmp_state: "Recepcionado", fce_account_state: "Modificable", fce_acceptance_due: "2026-11-25", fce_account_code: 77 });
    await fce(ctx, { issue_date: "2026-11-11", fce_cmp_state: "Aceptado", fce_account_state: "Aceptada", fce_acceptance: "accepted", fce_transfer_option: "ADC", fce_balance: "50000.50" });
    await fce(ctx, { issue_date: "2026-11-10", fce_cmp_state: "Rechazado", fce_account_state: "Rechazada", fce_acceptance: "rejected", fce_rejection_reasons: [{ code: 3, description: "x", justification: "y" }] });
    await fce(ctx, { cbte_tipo: 203, kind: "credit_note", associated_invoice_id: pending.id, fce_cmp_state: "Recepcionado" });
    await fce(ctx, { cbte_tipo: 1 });
    await fce(ctx, { source: "manual", arca_status: "manual", cbte_tipo: null });

    const res = await as(ctx.actor).get("/invoices/fce");
    expect(res.status).toBe(200);
    expect(res.body.data.map((r) => r.group)).toEqual(["pending", "accepted", "rejected"]);
    expect(res.body.summary).toEqual({ pending: 1, accepted: 1, rejected: 1, informed: 0, cancelled: 0, adc_pending: 1, total: 3 });
    const [first, second, third] = res.body.data;
    expect(first.client).toMatchObject({ razonSocial: ctx.client.razonSocial });
    expect(first.notes).toEqual([expect.objectContaining({ kind: "credit_note", cbte_tipo: 203, fce_cmp_state: "Recepcionado" })]);
    expect(first.fce_account_code).toBe(77);
    expect(typeof first.acceptance_days_left).toBe("number");
    expect(second).toMatchObject({ adc_pending: true, fce_balance: 50000.5 });
    expect(third.fce_rejection_reasons).toHaveLength(1);
    expect(third.acceptance_days_left).toBeNull();
    expect(first).not.toHaveProperty("fce_arca_snapshot");
  });

  it("filtra por estado, cliente, opción de transferencia y fechas", async () => {
    const ctx = await setup();
    const other = await createClient({ cuit: "30714522126" });
    await fce(ctx, { issue_date: "2026-11-12", fce_account_state: "Aceptada", fce_acceptance: "accepted", fce_transfer_option: "ADC" });
    await fce(ctx, { issue_date: "2026-10-01" });
    await fce(ctx, { client_id: other.id, issue_date: "2026-11-05" });
    const get = (query) => as(ctx.actor).get(`/invoices/fce?${query}`);
    expect((await get("state=accepted")).body.data).toHaveLength(1);
    expect((await get(`client_id=${other.id}`)).body.data).toHaveLength(1);
    expect((await get("transfer_option=ADC")).body.data).toHaveLength(1);
    expect((await get("date_from=2026-11-01&date_to=2026-11-10")).body.data).toHaveLength(1);
    expect((await get("state=cualquiera")).status).toBe(400);
    expect((await get("date_from=ayer")).status).toBe(400);
  });

  it("oculta las cerradas (anuladas, informadas al ADC, canceladas) salvo include_closed", async () => {
    const ctx = await setup();
    await fce(ctx);
    await fce(ctx, { fce_account_state: "InformadaAgDpto", fce_acceptance: "accepted" });
    await fce(ctx, { fce_account_state: "CanceladaTotal", fce_acceptance: "accepted" });
    await fce(ctx, { status: "cancelled" });
    const open = await as(ctx.actor).get("/invoices/fce");
    expect(open.body.data).toHaveLength(1);
    expect(open.body.summary.total).toBe(1);
    const all = await as(ctx.actor).get("/invoices/fce?include_closed=true");
    expect(all.body.data).toHaveLength(4);
    expect((await as(ctx.actor).get("/invoices/fce?state=informed")).body.data).toHaveLength(1);
  });

  it("una rechazada con su nota de crédito de anulación emitida lo informa (el aviso se va solo)", async () => {
    const ctx = await setup();
    const rejected = await fce(ctx, { fce_cmp_state: "Rechazado", fce_account_state: "Rechazada", fce_acceptance: "rejected" });
    let row = (await as(ctx.actor).get("/invoices/fce")).body.data[0];
    expect(row.annulment_note).toBeNull();
    await fce(ctx, { cbte_tipo: 203, kind: "credit_note", associated_invoice_id: rejected.id, fce_annulment: true, arca_status: "draft" });
    row = (await as(ctx.actor).get("/invoices/fce")).body.data[0];
    expect(row.annulment_note).toBeNull();
    await fce(ctx, { cbte_tipo: 203, kind: "credit_note", associated_invoice_id: rejected.id, fce_annulment: true });
    row = (await as(ctx.actor).get("/invoices/fce")).body.data[0];
    expect(row.annulment_note).toMatchObject({ arca_status: "authorized" });
  });

  it("trae la última sincronización y si ARCA está habilitado", async () => {
    const ctx = await setup();
    const at = new Date("2026-11-20T15:00:00Z");
    await db.SystemSetting.update({ last_fce_sync_at: at }, { where: { id: 1 } });
    const res = await as(ctx.actor).get("/invoices/fce");
    expect(new Date(res.body.last_sync_at).toISOString()).toBe(at.toISOString());
    expect(res.body.arca_enabled).toBe(true);
    delete process.env.ARCA_ENV;
    expect((await as(ctx.actor).get("/invoices/fce")).body.arca_enabled).toBe(false);
  });
});

describe("detalle de la factura", () => {
  it("el resumen del comprobante de ARCA solo sale en el detalle y para quien puede emitir", async () => {
    const ctx = await setup({ permissions: ["invoices_read", "invoices_emit"] });
    const inv = await fce(ctx, { fce_arca_snapshot: { codCtaCte: 1 }, fce_balance: "100.00", fce_account_code: 55 });
    const detail = await as(ctx.actor).get(`/invoices/${inv.id}`);
    expect(detail.body.data).toMatchObject({ fce_arca_snapshot: { codCtaCte: 1 }, fce_balance: 100, fce_account_code: 55 });
    const list = await as(ctx.actor).get("/invoices");
    expect(list.body.data[0]).not.toHaveProperty("fce_arca_snapshot");

    const reader = await createActor({ permissions: ["invoices_read"] });
    expect((await as(reader).get(`/invoices/${inv.id}`)).body.data).not.toHaveProperty("fce_arca_snapshot");
  });
});

describe("Probar conexión: paso de seguimiento de FCE", () => {
  beforeEach(() => {
    wsaa.getAuth.mockResolvedValue({ token: "T", sign: "S", cuit: COMPANY_CUIT, expiresAt: new Date(Date.now() + 3600000), source: "cache" });
    wsfe.dummy.mockResolvedValue({ app_server: "OK" });
    wsfe.getPointsOfSale.mockResolvedValue([]);
    wsfe.getExchangeRate.mockResolvedValue({ currency: "DOL", rate: 1000, date: "20261120" });
  });

  it("si wsfecred no está autorizado lo dice con qué autorizar y no afecta a los demás pasos", async () => {
    wsfecred.dummy.mockResolvedValue({ app_server: "OK" });
    wsfecred.getFecredAuth.mockRejectedValue(new ArcaError("afip", 'El CEE no posee autorización. Autorizá el servicio "Registro de Facturas de Crédito Electrónica MiPyMEs" (wsfecred).'));
    const result = await arca.testConnection();
    expect(result.fce_tracking).toMatchObject({ ok: false, error: expect.stringContaining("wsfecred") });
    expect(result.login.ok).toBe(true);
    expect(result.dummy.ok).toBe(true);
  });

  it("con wsfecred autorizado el paso sale bien", async () => {
    wsfecred.dummy.mockResolvedValue({ app_server: "OK" });
    wsfecred.getFecredAuth.mockResolvedValue({ expiresAt: new Date(Date.now() + 3600000), source: "login" });
    const result = await arca.testConnection();
    expect(result.fce_tracking).toMatchObject({ ok: true, source: "login", servers: { app_server: "OK" } });
  });
});

describe("reglas puras de seguimiento", () => {
  const { deriveAcceptance, stateGroup, isFinal } = require("../../services/arca/fceSync");

  it("la aceptación se deriva de los estados de ARCA", () => {
    expect(deriveAcceptance("Recepcionado", "Modificable")).toBe("pending");
    expect(deriveAcceptance("PendienteRecepcion", null)).toBe("pending");
    expect(deriveAcceptance("Aceptado", "Aceptada")).toBe("accepted");
    expect(deriveAcceptance("InformadaAgDpto", "InformadaAgDpto")).toBe("accepted");
    expect(deriveAcceptance("Recepcionado", "CanceladaTotal")).toBe("accepted");
    expect(deriveAcceptance("Rechazado", "Rechazada")).toBe("rejected");
    expect(deriveAcceptance("Recepcionado", "Rechazada")).toBe("rejected");
    expect(deriveAcceptance(null, null)).toBeNull();
  });

  it("agrupa para filtrar y contar", () => {
    expect(stateGroup({})).toBe("pending");
    expect(stateGroup({ fce_cmp_state: "Aceptado" })).toBe("accepted");
    expect(stateGroup({ fce_account_state: "InformadaAgDpto" })).toBe("informed");
    expect(stateGroup({ fce_account_state: "CanceladaTotal", fce_cmp_state: "Aceptado" })).toBe("cancelled");
    expect(stateGroup({ fce_cmp_state: "Rechazado" })).toBe("rejected");
  });

  it("estado final: rechazada, cancelada, informada, o aceptada con SCA; una aceptada con ADC todavía puede cambiar", () => {
    expect(isFinal({ kind: "invoice", fce_account_state: "Rechazada" })).toBe(true);
    expect(isFinal({ kind: "invoice", fce_account_state: "Aceptada", fce_transfer_option: "SCA" })).toBe(true);
    expect(isFinal({ kind: "invoice", fce_account_state: "Aceptada", fce_transfer_option: "ADC" })).toBe(false);
    expect(isFinal({ kind: "invoice", fce_account_state: "Modificable" })).toBe(false);
    expect(isFinal({ kind: "invoice" })).toBe(false);
    expect(isFinal({ kind: "credit_note", fce_cmp_state: "Rechazado" })).toBe(true);
    expect(isFinal({ kind: "credit_note", fce_cmp_state: "Recepcionado" })).toBe(false);
    expect(isFinal({ kind: "credit_note", fce_cmp_state: "Recepcionado" }, { originalFinal: true })).toBe(true);
    expect(isFinal({ kind: "credit_note", fce_cmp_state: null }, { originalFinal: true })).toBe(false);
  });
});
