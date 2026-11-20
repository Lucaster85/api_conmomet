"use strict";
// Barrido automático del seguimiento de FCE y avisos (FLOWS.md §78). ARCA (wsfe y wsfecred) simulado.
jest.mock("../../services/arca/wsfe", () => ({ dummy: jest.fn(), getPointsOfSale: jest.fn(), getLastAuthorized: jest.fn(), getVoucher: jest.fn(), requestCae: jest.fn(), getExchangeRate: jest.fn() }));
jest.mock("../../services/arca/wsfecred", () => ({
  checkAccess: jest.fn(), getFecredAuth: jest.fn(), consultarComprobantes: jest.fn(), consultarCtasCtes: jest.fn(),
  consultarHistorialEstadosComprobante: jest.fn(), consultarHistorialEstadosCtaCte: jest.fn(),
}));
jest.mock("../../helpers/r2Storage", () => ({
  ...jest.requireActual("../../helpers/r2Storage"),
  uploadToR2: jest.fn(async () => "https://files.test/x"),
  deleteFromR2: jest.fn(async () => {}),
}));

const db = require("../../models");
const wsfecred = require("../../services/arca/wsfecred");
const { ArcaError } = require("../../services/arca/errors");
const { syncFceStatuses, outcomesOf, THROTTLE_HOURS } = require("../../services/fceSyncNotifier");
const { isValidAlertType } = require("../../helpers/alertTypes");
const { isValidNotificationType } = require("../../helpers/notificationTypes");
const { createActor, as } = require("../helpers/auth");
const { createClient } = require("../factories/budget");

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
  process.env.ARCA_CUIT = "20123456786";
  await db.SystemSetting.update({ last_fce_sync_at: null }, { where: { id: 1 } });
  wsfecred.consultarComprobantes.mockResolvedValue({ items: [], truncated: false });
  wsfecred.consultarCtasCtes.mockResolvedValue({ items: [], truncated: false });
});

let counter = 100;
async function fce(ctx, over = {}) {
  counter += 1;
  return db.Invoice.create({
    voucher_type: "A", cbte_tipo: 201, pos_number: 3, number: counter, issue_date: "2026-11-10", client_id: ctx.client.id, currency: "ARS",
    net_amount: 100000, iva_rate: 21, iva_amount: 21000, total_amount: 121000, source: "arca", arca_status: "authorized", arca_env: "homologacion", cae: "76123456789012",
    fce_transfer_option: "SCA", fce_acceptance: "pending", fce_cmp_state: "Recepcionado", fce_account_state: "Modificable", created_by: ctx.actor.user.id, ...over,
  });
}
const cmp = (inv, over = {}) => ({
  cbte_tipo: inv.cbte_tipo, pos_number: inv.pos_number, number: inv.number, recipient_cuit: "30716396653", cmp_state: "Recepcionado", cmp_state_at: new Date(), account_code: 9000 + inv.number,
  acceptance_type: null, accepted_at: null, available_at: null, acceptance_due: null, payment_due: null, rejection_reasons: [], transfer_option: null, snapshot: {}, ...over,
});
const cta = (inv, over = {}) => ({ account_code: 9000 + inv.number, account_state: "Modificable", cbte_tipo: inv.cbte_tipo, pos_number: inv.pos_number, number: inv.number, balance: 121000, accepted_balance: null, transfer_option: null, ...over });
const arcaReturns = (comprobantes, cuentas) => {
  wsfecred.consultarComprobantes.mockResolvedValue({ items: comprobantes, truncated: false });
  wsfecred.consultarCtasCtes.mockResolvedValue({ items: cuentas, truncated: false });
};
async function setup() {
  const actor = await createActor({ permissions: ["invoices_read", "invoices_write"] });
  const client = await createClient({ razonSocial: "Bunge Argentina", cuit: "30716396653" });
  return { actor, client };
}

describe("syncFceStatuses — throttle", () => {
  it("la primera vez sincroniza y la segunda seguida no", async () => {
    const ctx = await setup();
    const inv = await fce(ctx);
    arcaReturns([cmp(inv)], [cta(inv)]);
    const first = await syncFceStatuses();
    const second = await syncFceStatuses();
    expect(first).toMatchObject({ ran: true, checked: 1 });
    expect(second.ran).toBe(false);
    expect(wsfecred.consultarComprobantes).toHaveBeenCalledTimes(1);
  });

  it("vuelve a sincronizar pasadas las 6 horas, y no antes", async () => {
    const ctx = await setup();
    const inv = await fce(ctx);
    arcaReturns([cmp(inv)], [cta(inv)]);
    await syncFceStatuses();
    await db.SystemSetting.update({ last_fce_sync_at: new Date(Date.now() - (THROTTLE_HOURS - 1) * 3600000) }, { where: { id: 1 } });
    expect((await syncFceStatuses()).ran).toBe(false);
    await db.SystemSetting.update({ last_fce_sync_at: new Date(Date.now() - (THROTTLE_HOURS + 1) * 3600000) }, { where: { id: 1 } });
    expect((await syncFceStatuses()).ran).toBe(true);
  });

  it("una sincronización a mano reciente también cuenta: el barrido no se repite", async () => {
    const ctx = await setup();
    const inv = await fce(ctx);
    arcaReturns([cmp(inv)], [cta(inv)]);
    expect((await as(ctx.actor).post("/invoices/fce/sync").send({})).status).toBe(200);
    expect((await syncFceStatuses()).ran).toBe(false);
  });

  it("con la integración apagada no hace nada ni consume el turno", async () => {
    delete process.env.ARCA_ENV;
    expect((await syncFceStatuses()).ran).toBe(false);
    expect((await db.SystemSetting.findByPk(1)).last_fce_sync_at).toBeNull();
    expect(wsfecred.consultarComprobantes).not.toHaveBeenCalled();
  });

  it("un error de ARCA no lanza, queda en el log y no se reintenta hasta dentro de 6 horas", async () => {
    const ctx = await setup();
    await fce(ctx);
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    wsfecred.consultarComprobantes.mockRejectedValue(new ArcaError("afip", "El servicio wsfecred no está autorizado."));
    await expect(syncFceStatuses()).resolves.toMatchObject({ ran: true, updated: 0 });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("[fce-sync]"), expect.stringContaining("wsfecred"));
    await syncFceStatuses();
    expect(wsfecred.consultarComprobantes).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it("el latido de la campanita no se rompe aunque ARCA falle", async () => {
    const ctx = await setup();
    await fce(ctx);
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    wsfecred.consultarComprobantes.mockRejectedValue(new Error("boom"));
    const res = await as(ctx.actor).get("/me/notifications/unread-count");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("unread_count");
    await new Promise((resolve) => setTimeout(resolve, 150));
    log.mockRestore();
  });

  it("sin nada para seguir no llama a ARCA", async () => {
    await setup();
    expect(await syncFceStatuses()).toMatchObject({ ran: true, checked: 0 });
    expect(wsfecred.consultarComprobantes).not.toHaveBeenCalled();
  });
});

describe("campanita: FCE aceptada o rechazada", () => {
  it("avisa a quienes tienen invoices_read cuando una FCE pasa a Aceptada, una sola vez", async () => {
    const ctx = await setup();
    const other = await createActor({ permissions: ["invoices_read"] });
    const outsider = await createActor({ permissions: ["documents_read"] });
    const inv = await fce(ctx);
    arcaReturns([cmp(inv, { cmp_state: "Aceptado", acceptance_type: "Tacita" })], [cta(inv, { account_state: "Aceptada" })]);
    const first = await syncFceStatuses();
    expect(first.notified).toBe(2);

    const mine = await db.Notification.findAll({ where: { user_id: ctx.actor.user.id } });
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ type: "fce_accepted", entity_type: "invoice", entity_id: inv.id, url: "/dashboard/billing?tab=fce" });
    expect(mine[0].body).toMatch(/Bunge Argentina/);
    expect(await db.Notification.count({ where: { user_id: other.user.id } })).toBe(1);
    expect(await db.Notification.count({ where: { user_id: outsider.user.id } })).toBe(0);

    await db.SystemSetting.update({ last_fce_sync_at: null }, { where: { id: 1 } });
    expect((await syncFceStatuses()).notified).toBe(0);
    expect(await db.Notification.count({ where: { user_id: ctx.actor.user.id } })).toBe(1);
  });

  it("avisa un rechazo con el pedido de la nota de anulación", async () => {
    const ctx = await setup();
    const inv = await fce(ctx);
    arcaReturns([cmp(inv, { cmp_state: "Rechazado" })], [cta(inv, { account_state: "Rechazada" })]);
    await syncFceStatuses();
    const note = await db.Notification.findOne({ where: { user_id: ctx.actor.user.id } });
    expect(note).toMatchObject({ type: "fce_rejected", title: "FCE rechazada por el cliente" });
    expect(note.body).toMatch(/nota de crédito de anulación/);
  });

  it("no avisa la primera vez que se ve una FCE (aunque ya esté aceptada), ni un cambio que no es aceptación ni rechazo", async () => {
    const ctx = await setup();
    const neverSynced = await fce(ctx, { fce_cmp_state: null, fce_account_state: null });
    const waiting = await fce(ctx, { fce_cmp_state: "PendienteRecepcion" });
    arcaReturns([cmp(neverSynced, { cmp_state: "Aceptado" }), cmp(waiting, { cmp_state: "Recepcionado" })], [cta(neverSynced, { account_state: "Aceptada" }), cta(waiting)]);
    const result = await syncFceStatuses();
    expect(result.updated).toBe(2);
    expect(result.notified).toBe(0);
  });

  it("una sincronización a mano también avisa a los demás", async () => {
    const ctx = await setup();
    const other = await createActor({ permissions: ["invoices_read"] });
    const inv = await fce(ctx);
    arcaReturns([cmp(inv, { cmp_state: "Aceptado" })], [cta(inv, { account_state: "Aceptada" })]);
    expect((await as(ctx.actor).post("/invoices/fce/sync").send({})).status).toBe(200);
    expect(await db.Notification.count({ where: { user_id: other.user.id, type: "fce_accepted" } })).toBe(1);
  });

  it("una nota de crédito rechazada no genera aviso de FCE", async () => {
    const ctx = await setup();
    const original = await fce(ctx);
    const note = await fce(ctx, { cbte_tipo: 203, kind: "credit_note", associated_invoice_id: original.id, fce_account_state: null });
    arcaReturns([cmp(original), cmp(note, { cmp_state: "Rechazado" })], [cta(original)]);
    expect((await syncFceStatuses()).notified).toBe(0);
  });

  it("outcomesOf: el rechazo gana a la aceptación y solo cuentan los cambios con estado anterior", () => {
    const outcomes = outcomesOf([
      { invoice_id: 1, field: "fce_cmp_state", from: "Recepcionado", to: "Aceptado" },
      { invoice_id: 1, field: "fce_account_state", from: "Modificable", to: "Rechazada" },
      { invoice_id: 2, field: "fce_cmp_state", from: null, to: "Aceptado" },
      { invoice_id: 3, field: "fce_transfer_option", from: "SCA", to: "ADC" },
    ]);
    expect([...outcomes.entries()]).toEqual([[1, "rejected"]]);
  });
});

describe("vocabulario", () => {
  it("los avisos del tablero y los tipos de notificación nuevos están en la lista blanca", () => {
    expect(isValidAlertType("fce_rejected")).toBe(true);
    expect(isValidAlertType("fce_adc_pending")).toBe(true);
    expect(isValidNotificationType("fce_accepted")).toBe(true);
    expect(isValidNotificationType("fce_rejected")).toBe(true);
  });

  it("un usuario puede dejar acuse de vista de los avisos nuevos", async () => {
    const actor = await createActor({ permissions: ["invoices_read"] });
    for (const alert_type of ["fce_rejected", "fce_adc_pending"]) {
      const res = await as(actor).post("/me/alert-views").send({ alert_type, items: [{ entity_id: 1, revision: "x" }] });
      expect(res.status).toBeLessThan(300);
    }
  });
});
