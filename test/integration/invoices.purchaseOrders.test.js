"use strict";
// OC del cliente, cauciones y documentos extra del presupuesto (PLAN_ARCA.md etapa 6, FLOWS.md §69). R2 simulado.
jest.mock("../../helpers/r2Storage", () => ({
  ...jest.requireActual("../../helpers/r2Storage"),
  uploadToR2: jest.fn(async (file, folder) => `https://files.test/${folder}/${file.originalname}`),
  deleteFromR2: jest.fn(async () => {}),
}));

const db = require("../../models");
const r2 = require("../../helpers/r2Storage");
const { todayInArgentina } = require("../../helpers/argentinaDate");
const { syncExpirationNotifications } = require("../../services/expirationNotifier");
const { createActor, as } = require("../helpers/auth");
const { createClient, createBudget } = require("../factories/budget");

const PDF = Buffer.from("%PDF-1.4 test");
const inDays = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const FULL = ["invoices_read", "invoices_write", "invoices_update", "invoices_delete"];

beforeEach(() => jest.clearAllMocks());

async function setup(permissions = FULL, budgetOverrides = {}) {
  const actor = await createActor({ permissions });
  const client = await createClient();
  const budget = await createBudget({ clientId: client.id, createdBy: actor.user.id, status: "approved", approved_at: new Date(), ...budgetOverrides });
  return { actor, client, budget };
}

const orderBody = (budgetId, overrides = {}) => ({ budget_id: budgetId, number: "OC-100", date: "2026-11-10", ...overrides });
const createOrder = (actor, budgetId, overrides) => as(actor).post("/invoices/purchase-orders").send(orderBody(budgetId, overrides));

describe("POST /invoices/purchase-orders", () => {
  it("crea una OC con posiciones y le deja la moneda del presupuesto", async () => {
    const { actor, budget } = await setup();
    const res = await createOrder(actor, budget.id, {
      amount: 150000.5, concept: "materials", payment_terms: "30 días",
      items: [{ position: "10", description: "Caños", amount: 100000 }, { position: "20", description: "Mano de obra" }],
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ number: "OC-100", status: "active", currency: budget.currency, concept: "materials", amount: 150000.5 });
    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data.items[1].amount).toBeNull();
  });

  it("acepta una OC sin monto (solo de referencia)", async () => {
    const { actor, budget } = await setup();
    const res = await createOrder(actor, budget.id);
    expect(res.status).toBe(201);
    expect(res.body.data.amount).toBeNull();
  });

  it("acepta multipart con archivos y las posiciones como JSON", async () => {
    const { actor, budget } = await setup();
    const res = await as(actor).post("/invoices/purchase-orders")
      .field("budget_id", String(budget.id)).field("number", "OC-7").field("date", "2026-11-10")
      .field("items", JSON.stringify([{ description: "Pos 1" }]))
      .attach("files", PDF, { filename: "oc.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(201);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.files).toHaveLength(1);
    expect(res.body.data.files[0]).toMatchObject({ file_name: "oc.pdf", file_url: "https://files.test/purchase-orders/" + res.body.data.id + "/oc.pdf" });
    expect(r2.uploadToR2).toHaveBeenCalledTimes(1);
  });

  it("rechaza un archivo de formato no permitido", async () => {
    const { actor, budget } = await setup();
    const res = await as(actor).post("/invoices/purchase-orders")
      .field("budget_id", String(budget.id)).field("number", "OC-7").field("date", "2026-11-10")
      .attach("files", Buffer.from("MZ"), { filename: "virus.exe", contentType: "application/octet-stream" });
    expect(res.status).toBe(400);
    expect(await db.ClientPurchaseOrder.count()).toBe(0);
  });

  it("solo se carga sobre presupuestos aprobados", async () => {
    const { actor, client } = await setup();
    const draft = await createBudget({ clientId: client.id, createdBy: actor.user.id, status: "draft" });
    const res = await createOrder(actor, draft.id);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/aprobados/);
  });

  it.each([
    ["sin número", { number: "  " }, /número/],
    ["sin fecha", { date: "" }, /fecha/],
    ["con fecha inexistente", { date: "2026-02-31" }, /fecha/],
    ["con monto cero", { amount: 0 }, /monto/],
    ["con concepto inválido", { concept: "otro" }, /concepto/],
    ["con una posición sin descripción", { items: [{ position: "10" }] }, /descripción/],
  ])("rechaza una OC %s", async (_label, overrides, message) => {
    const { actor, budget } = await setup();
    const res = await createOrder(actor, budget.id, overrides);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });

  it("no permite dos OC vigentes con el mismo número en el presupuesto", async () => {
    const { actor, budget } = await setup();
    await createOrder(actor, budget.id);
    const res = await createOrder(actor, budget.id);
    expect(res.status).toBe(409);
  });

  it("deja que otro presupuesto use el mismo número", async () => {
    const { actor, budget, client } = await setup();
    const other = await createBudget({ clientId: client.id, createdBy: actor.user.id, status: "approved" });
    await createOrder(actor, budget.id);
    expect((await createOrder(actor, other.id)).status).toBe(201);
  });
});

describe("PUT /invoices/purchase-orders/:id", () => {
  it("corrige los datos y reemplaza las posiciones", async () => {
    const { actor, budget } = await setup();
    const created = (await createOrder(actor, budget.id, { items: [{ description: "A" }, { description: "B" }] })).body.data;
    const res = await as(actor).put(`/invoices/purchase-orders/${created.id}`).send(orderBody(budget.id, { number: "OC-101", items: [{ description: "C" }] }));
    expect(res.status).toBe(200);
    expect(res.body.data.number).toBe("OC-101");
    expect(res.body.data.items.map((i) => i.description)).toEqual(["C"]);
  });

  it("no edita una OC rechazada", async () => {
    const { actor, budget } = await setup();
    const created = (await createOrder(actor, budget.id)).body.data;
    await as(actor).put(`/invoices/purchase-orders/${created.id}/reject`).send({ reason: "Mal cargada" });
    const res = await as(actor).put(`/invoices/purchase-orders/${created.id}`).send(orderBody(budget.id));
    expect(res.status).toBe(409);
  });

  it("limpia las notas de ajuste si la OC deja de admitirlo", async () => {
    const { actor, budget } = await setup();
    const created = (await createOrder(actor, budget.id, { allows_adjustment: true, adjustment_type: "uocra", adjustment_notes: "Cada 3 meses" })).body.data;
    expect(created.adjustment_notes).toBe("Cada 3 meses");
    const res = await as(actor).put(`/invoices/purchase-orders/${created.id}`).send(orderBody(budget.id, { allows_adjustment: false, adjustment_notes: "Cada 3 meses" }));
    expect(res.body.data.adjustment_notes).toBeNull();
  });
});

describe("rechazar y reemplazar una OC", () => {
  it("rechazar pide motivo y deja la OC guardada como rechazada", async () => {
    const { actor, budget } = await setup();
    const created = (await createOrder(actor, budget.id)).body.data;
    expect((await as(actor).put(`/invoices/purchase-orders/${created.id}/reject`).send({})).status).toBe(400);
    const res = await as(actor).put(`/invoices/purchase-orders/${created.id}/reject`).send({ reason: "Monto incorrecto" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "rejected", rejection_reason: "Monto incorrecto" });
  });

  it("reemplazar deja la original 'reemplazada' con su motivo y la nueva la referencia", async () => {
    const { actor, budget } = await setup();
    const old = (await createOrder(actor, budget.id)).body.data;
    const res = await as(actor).post(`/invoices/purchase-orders/${old.id}/replace`).send(orderBody(budget.id, { amount: 99, reason: "Cambió el monto" }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ number: "OC-100", status: "active", replaces_id: old.id });
    const reloaded = await db.ClientPurchaseOrder.findByPk(old.id);
    expect(reloaded).toMatchObject({ status: "replaced", rejection_reason: "Cambió el monto" });
  });

  it("reemplazar sin motivo no toca la original", async () => {
    const { actor, budget } = await setup();
    const old = (await createOrder(actor, budget.id)).body.data;
    const res = await as(actor).post(`/invoices/purchase-orders/${old.id}/replace`).send(orderBody(budget.id));
    expect(res.status).toBe(400);
    expect((await db.ClientPurchaseOrder.findByPk(old.id)).status).toBe("active");
  });

  it("no se rechaza ni se reemplaza una OC que ya no está vigente", async () => {
    const { actor, budget } = await setup();
    const old = (await createOrder(actor, budget.id)).body.data;
    await as(actor).put(`/invoices/purchase-orders/${old.id}/reject`).send({ reason: "x" });
    expect((await as(actor).put(`/invoices/purchase-orders/${old.id}/reject`).send({ reason: "y" })).status).toBe(409);
    expect((await as(actor).post(`/invoices/purchase-orders/${old.id}/replace`).send(orderBody(budget.id, { reason: "z" }))).status).toBe(409);
  });
});

describe("DELETE /invoices/purchase-orders/:id y archivos", () => {
  it("elimina la OC con sus posiciones y archivos, y borra los archivos de R2", async () => {
    const { actor, budget } = await setup();
    const created = (await as(actor).post("/invoices/purchase-orders")
      .field("budget_id", String(budget.id)).field("number", "OC-9").field("date", "2026-11-10")
      .field("items", JSON.stringify([{ description: "P" }]))
      .attach("files", PDF, { filename: "oc.pdf", contentType: "application/pdf" })).body.data;
    const res = await as(actor).delete(`/invoices/purchase-orders/${created.id}`);
    expect(res.status).toBe(200);
    expect(await db.ClientPurchaseOrder.count()).toBe(0);
    expect(await db.ClientPurchaseOrderItem.count()).toBe(0);
    expect(r2.deleteFromR2).toHaveBeenCalledTimes(1);
  });

  it("no elimina una OC con cauciones asociadas", async () => {
    const { actor, budget } = await setup();
    const order = (await createOrder(actor, budget.id)).body.data;
    await as(actor).post("/invoices/surety-bonds").send({ budget_id: budget.id, purchase_order_id: order.id, insurer: "Aseg", policy_number: "P1", amount: 1000 });
    const res = await as(actor).delete(`/invoices/purchase-orders/${order.id}`);
    expect(res.status).toBe(409);
    expect(await db.ClientPurchaseOrder.count()).toBe(1);
  });

  it("agrega y quita archivos de una OC existente", async () => {
    const { actor, budget } = await setup();
    const order = (await createOrder(actor, budget.id)).body.data;
    const added = await as(actor).post(`/invoices/purchase-orders/${order.id}/files`).attach("files", PDF, { filename: "a.pdf", contentType: "application/pdf" });
    expect(added.status).toBe(200);
    expect(added.body.data.files).toHaveLength(1);
    const removed = await as(actor).delete(`/invoices/purchase-orders/${order.id}/files/${added.body.data.files[0].id}`);
    expect(removed.status).toBe(200);
    expect(removed.body.data.files).toHaveLength(0);
    expect(r2.deleteFromR2).toHaveBeenCalledTimes(1);
  });

  it("agregar archivos sin adjuntar nada es un error", async () => {
    const { actor, budget } = await setup();
    const order = (await createOrder(actor, budget.id)).body.data;
    expect((await as(actor).post(`/invoices/purchase-orders/${order.id}/files`).send({})).status).toBe(400);
  });

  it("un fallo de R2 no tira la OC: queda creada y avisa qué archivo falló", async () => {
    const { actor, budget } = await setup();
    r2.uploadToR2.mockRejectedValueOnce(new Error("R2 caído"));
    jest.spyOn(console, "error").mockImplementation(() => {});
    const res = await as(actor).post("/invoices/purchase-orders")
      .field("budget_id", String(budget.id)).field("number", "OC-8").field("date", "2026-11-10")
      .attach("files", PDF, { filename: "oc.pdf", contentType: "application/pdf" });
    console.error.mockRestore();
    expect(res.status).toBe(201);
    expect(res.body.data.files).toHaveLength(0);
    expect(res.body.warnings[0]).toMatch(/oc\.pdf/);
  });
});

describe("'No lleva OC' y presupuestos sin OC", () => {
  it("el aviso trae el N° de presupuesto del cliente, que es el que cita la OC (FLOWS.md §79)", async () => {
    const { actor, budget } = await setup();
    await budget.update({ client_budget_number: "CLI-5540" });

    const [row] = (await as(actor).get("/invoices/purchase-orders/missing")).body.data;

    expect(row).toMatchObject({ id: budget.id, client_budget_number: "CLI-5540" });
  });

  it("lista los aprobados sin OC vigente y deja de listar al cargar una OC", async () => {
    const { actor, budget } = await setup();
    expect((await as(actor).get("/invoices/purchase-orders/missing")).body.data.map((b) => b.id)).toEqual([budget.id]);
    await createOrder(actor, budget.id);
    expect((await as(actor).get("/invoices/purchase-orders/missing")).body.data).toEqual([]);
  });

  it("una OC rechazada vuelve a dejar el presupuesto en la lista", async () => {
    const { actor, budget } = await setup();
    const order = (await createOrder(actor, budget.id)).body.data;
    await as(actor).put(`/invoices/purchase-orders/${order.id}/reject`).send({ reason: "x" });
    expect((await as(actor).get("/invoices/purchase-orders/missing")).body.data).toHaveLength(1);
  });

  it("no lista los presupuestos que no están aprobados", async () => {
    const { actor, client } = await setup();
    await createBudget({ clientId: client.id, createdBy: actor.user.id, status: "draft" });
    const ids = (await as(actor).get("/invoices/purchase-orders/missing")).body.data.map((b) => b.id);
    expect(ids).toHaveLength(1);
  });

  it("marcar 'no lleva OC' saca el presupuesto de la lista y se puede revertir", async () => {
    const { actor, budget } = await setup();
    const marked = await as(actor).put(`/invoices/budgets/${budget.id}/purchase-order-not-required`).send({ value: true });
    expect(marked.status).toBe(200);
    expect(marked.body.data.purchase_order_not_required).toBe(true);
    expect((await as(actor).get("/invoices/purchase-orders/missing")).body.data).toEqual([]);
    await as(actor).put(`/invoices/budgets/${budget.id}/purchase-order-not-required`).send({ value: false });
    expect((await as(actor).get("/invoices/purchase-orders/missing")).body.data).toHaveLength(1);
  });

  it("rechaza un valor que no es booleano", async () => {
    const { actor, budget } = await setup();
    expect((await as(actor).put(`/invoices/budgets/${budget.id}/purchase-order-not-required`).send({ value: "quizás" })).status).toBe(400);
  });
});

describe("seguros de caución", () => {
  const bondBody = (budgetId, overrides = {}) => ({ budget_id: budgetId, insurer: "Aseguradora SA", policy_number: "POL-1", amount: 50000, ...overrides });

  it("crea una caución con un archivo y la devuelve con su estado", async () => {
    const { actor, budget } = await setup();
    const res = await as(actor).post("/invoices/surety-bonds")
      .field("budget_id", String(budget.id)).field("insurer", "Aseguradora SA").field("policy_number", "POL-1").field("amount", "50000")
      .field("expiration_date", inDays(10)).field("notify_days_before", "30")
      .attach("files", PDF, { filename: "poliza.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: "expiring_soon", days_left: 10, file_name: "poliza.pdf", amount: 50000, purpose: "advance_payment" });
  });

  it("una caución sin vencimiento queda 'sin vencimiento'", async () => {
    const { actor, budget } = await setup();
    const res = await as(actor).post("/invoices/surety-bonds").send(bondBody(budget.id));
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("no_expiration");
  });

  it("valida la OC asociada: tiene que ser del mismo presupuesto", async () => {
    const { actor, budget, client } = await setup();
    const other = await createBudget({ clientId: client.id, createdBy: actor.user.id, status: "approved" });
    const order = (await createOrder(actor, other.id)).body.data;
    const res = await as(actor).post("/invoices/surety-bonds").send(bondBody(budget.id, { purchase_order_id: order.id }));
    expect(res.status).toBe(400);
  });

  it.each([
    ["sin aseguradora", { insurer: "" }, /aseguradora/],
    ["sin número de póliza", { policy_number: "" }, /póliza/],
    ["sin monto", { amount: "" }, /monto/],
    ["con vencimiento anterior a la emisión", { issue_date: "2026-11-10", expiration_date: "2026-11-01" }, /anterior/],
    ["con días de aviso fuera de rango", { notify_days_before: 400 }, /días/],
  ])("rechaza una caución %s", async (_label, overrides, message) => {
    const { actor, budget } = await setup();
    const res = await as(actor).post("/invoices/surety-bonds").send(bondBody(budget.id, overrides));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });

  it("al subir otro archivo en la edición, borra el anterior de R2", async () => {
    const { actor, budget } = await setup();
    const bond = (await as(actor).post("/invoices/surety-bonds")
      .field("budget_id", String(budget.id)).field("insurer", "A").field("policy_number", "P").field("amount", "10")
      .attach("files", PDF, { filename: "v1.pdf", contentType: "application/pdf" })).body.data;
    const res = await as(actor).put(`/invoices/surety-bonds/${bond.id}`)
      .field("insurer", "A").field("policy_number", "P").field("amount", "10")
      .attach("files", PDF, { filename: "v2.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(200);
    expect(res.body.data.file_name).toBe("v2.pdf");
    expect(r2.deleteFromR2).toHaveBeenCalledWith(expect.stringContaining("v1.pdf"));
  });

  it("liberar una caución corta los avisos y se puede revertir", async () => {
    const { actor, budget } = await setup();
    const bond = (await as(actor).post("/invoices/surety-bonds").send(bondBody(budget.id, { expiration_date: inDays(5) }))).body.data;
    expect((await as(actor).get("/invoices/surety-bonds/alerts")).body.data).toHaveLength(1);
    const released = await as(actor).put(`/invoices/surety-bonds/${bond.id}/release`).send({ released: true });
    expect(released.body.data).toMatchObject({ status: "released", released_at: todayInArgentina() });
    expect((await as(actor).get("/invoices/surety-bonds/alerts")).body.data).toEqual([]);
    const back = await as(actor).put(`/invoices/surety-bonds/${bond.id}/release`).send({ released: false });
    expect(back.body.data.status).toBe("expiring_soon");
  });

  it("las alertas traen solo las vencidas y las por vencer, con el presupuesto y el cliente", async () => {
    const { actor, budget } = await setup();
    await as(actor).post("/invoices/surety-bonds").send(bondBody(budget.id, { policy_number: "VENCIDA", expiration_date: inDays(-3) }));
    await as(actor).post("/invoices/surety-bonds").send(bondBody(budget.id, { policy_number: "PRONTO", expiration_date: inDays(7) }));
    await as(actor).post("/invoices/surety-bonds").send(bondBody(budget.id, { policy_number: "LEJOS", expiration_date: inDays(200) }));
    await as(actor).post("/invoices/surety-bonds").send(bondBody(budget.id, { policy_number: "SIN-FECHA" }));
    const res = await as(actor).get("/invoices/surety-bonds/alerts");
    expect(res.body.data.map((b) => [b.policy_number, b.status])).toEqual([["VENCIDA", "expired"], ["PRONTO", "expiring_soon"]]);
    expect(res.body.data[0].budget.client.razonSocial).toBeTruthy();
  });

  it("elimina una caución y borra su archivo de R2", async () => {
    const { actor, budget } = await setup();
    const bond = (await as(actor).post("/invoices/surety-bonds")
      .field("budget_id", String(budget.id)).field("insurer", "A").field("policy_number", "P").field("amount", "10")
      .attach("files", PDF, { filename: "v1.pdf", contentType: "application/pdf" })).body.data;
    expect((await as(actor).delete(`/invoices/surety-bonds/${bond.id}`)).status).toBe(200);
    expect(await db.SuretyBond.count()).toBe(0);
    expect(r2.deleteFromR2).toHaveBeenCalledTimes(1);
  });
});

describe("notificaciones de cauciones (syncExpirationNotifications)", () => {
  beforeEach(() => db.SystemSetting.update({ last_expiration_sync_at: null }, { where: { id: 1 } }));

  it("avisa una sola vez por usuario con invoices_read cuando la caución está por vencer, y de nuevo cuando vence", async () => {
    const { actor, budget } = await setup();
    const reader = await createActor({ permissions: ["invoices_read"] });
    const outsider = await createActor({ permissions: ["documents_read"] });
    const bond = (await as(actor).post("/invoices/surety-bonds").send({ budget_id: budget.id, insurer: "A", policy_number: "P", amount: 10, expiration_date: inDays(5) })).body.data;

    await syncExpirationNotifications();
    await db.SystemSetting.update({ last_expiration_sync_at: null }, { where: { id: 1 } });
    await syncExpirationNotifications();

    const soon = await db.Notification.findAll({ where: { type: "surety_bond_expiring", entity_id: bond.id } });
    expect(soon.map((n) => n.user_id).sort()).toEqual([actor.user.id, reader.user.id].sort());
    expect(soon.every((n) => n.url === `/dashboard/billing/${budget.id}`)).toBe(true);
    expect(await db.Notification.count({ where: { user_id: outsider.user.id, entity_type: "surety_bond" } })).toBe(0);

    await db.SuretyBond.update({ expiration_date: inDays(-1) }, { where: { id: bond.id } });
    await db.SystemSetting.update({ last_expiration_sync_at: null }, { where: { id: 1 } });
    await syncExpirationNotifications();
    expect(await db.Notification.count({ where: { type: "surety_bond_expired", entity_id: bond.id } })).toBe(2);
  });

  it("no avisa de una caución liberada ni de una sin vencimiento", async () => {
    const { actor, budget } = await setup();
    const released = (await as(actor).post("/invoices/surety-bonds").send({ budget_id: budget.id, insurer: "A", policy_number: "P1", amount: 10, expiration_date: inDays(2) })).body.data;
    await as(actor).put(`/invoices/surety-bonds/${released.id}/release`).send({ released: true });
    await as(actor).post("/invoices/surety-bonds").send({ budget_id: budget.id, insurer: "A", policy_number: "P2", amount: 10 });
    await syncExpirationNotifications();
    expect(await db.Notification.count({ where: { entity_type: "surety_bond" } })).toBe(0);
  });
});

describe("detalle y listado de facturación", () => {
  it("el detalle trae OC, cauciones, documentos y la marca 'no lleva OC'", async () => {
    const { actor, budget } = await setup();
    await createOrder(actor, budget.id);
    await as(actor).post("/invoices/surety-bonds").send({ budget_id: budget.id, insurer: "A", policy_number: "P", amount: 10 });
    await as(actor).post("/invoices/billing-files").field("budget_id", String(budget.id)).field("description", "Contrato")
      .attach("files", PDF, { filename: "contrato.pdf", contentType: "application/pdf" });
    const res = await as(actor).get(`/invoices/billables/${budget.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.purchase_orders).toHaveLength(1);
    expect(res.body.data.surety_bonds).toHaveLength(1);
    expect(res.body.data.billing_files).toMatchObject([{ file_name: "contrato.pdf", description: "Contrato" }]);
    expect(res.body.data.purchase_order_not_required).toBe(false);
  });

  it("el listado resume las OC vigentes de cada presupuesto", async () => {
    const { actor, budget, client } = await setup();
    const bare = await createBudget({ clientId: client.id, createdBy: actor.user.id, status: "approved" });
    await as(actor).put(`/invoices/budgets/${bare.id}/purchase-order-not-required`).send({ value: true });
    await createOrder(actor, budget.id);
    await createOrder(actor, budget.id, { number: "OC-200" });
    const rows = (await as(actor).get("/invoices/billables")).body.data;
    expect(rows.find((r) => r.id === budget.id).purchase_order).toMatchObject({ active_count: 2, numbers: ["OC-100", "OC-200"], not_required: false });
    expect(rows.find((r) => r.id === bare.id).purchase_order).toMatchObject({ active_count: 0, numbers: [], not_required: true });
  });
});

describe("documentos extra del presupuesto", () => {
  it("adjunta varios archivos con una descripción y los elimina de a uno", async () => {
    const { actor, budget } = await setup();
    const res = await as(actor).post("/invoices/billing-files").field("budget_id", String(budget.id)).field("description", "Planillas")
      .attach("files", PDF, { filename: "a.pdf", contentType: "application/pdf" })
      .attach("files", PDF, { filename: "b.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveLength(2);
    expect((await as(actor).delete(`/invoices/billing-files/${res.body.data[0].id}`)).status).toBe(200);
    expect(await db.BudgetBillingFile.count()).toBe(1);
    expect(r2.deleteFromR2).toHaveBeenCalledTimes(1);
  });

  it("pide al menos un archivo", async () => {
    const { actor, budget } = await setup();
    expect((await as(actor).post("/invoices/billing-files").send({ budget_id: budget.id })).status).toBe(400);
  });
});

describe("permisos", () => {
  it.each([
    ["GET", "/invoices/purchase-orders/missing", "invoices_read"],
    ["GET", "/invoices/surety-bonds/alerts", "invoices_read"],
  ])("%s %s pide %s", async (method, path, permission) => {
    const withIt = await createActor({ permissions: [permission] });
    const without = await createActor({ permissions: ["documents_read"] });
    const admin = await createActor({ role: "admin" });
    expect((await as(withIt).get(path)).status).toBe(200);
    expect((await as(without).get(path)).status).toBe(401);
    expect((await as(admin).get(path)).status).toBe(200);
  });

  it("cargar una OC pide invoices_write y borrarla invoices_delete", async () => {
    const { actor: owner, budget } = await setup();
    const reader = await createActor({ permissions: ["invoices_read"] });
    const writer = await createActor({ permissions: ["invoices_write"] });
    const admin = await createActor({ role: "admin" });
    expect((await createOrder(reader, budget.id)).status).toBe(401);
    expect((await createOrder(writer, budget.id)).status).toBe(201);
    const id = (await createOrder(admin, budget.id, { number: "OC-ADM" })).body.data.id;
    expect((await as(writer).delete(`/invoices/purchase-orders/${id}`)).status).toBe(401);
    expect((await as(owner).delete(`/invoices/purchase-orders/${id}`)).status).toBe(200);
  });

  it("editar una OC o marcar 'no lleva OC' pide invoices_update", async () => {
    const { actor, budget } = await setup();
    const id = (await createOrder(actor, budget.id)).body.data.id;
    const writer = await createActor({ permissions: ["invoices_write"] });
    const updater = await createActor({ permissions: ["invoices_update"] });
    expect((await as(writer).put(`/invoices/purchase-orders/${id}`).send(orderBody(budget.id))).status).toBe(401);
    expect((await as(updater).put(`/invoices/purchase-orders/${id}`).send(orderBody(budget.id))).status).toBe(200);
    expect((await as(writer).put(`/invoices/budgets/${budget.id}/purchase-order-not-required`).send({ value: true })).status).toBe(401);
    expect((await as(updater).put(`/invoices/budgets/${budget.id}/purchase-order-not-required`).send({ value: true })).status).toBe(200);
  });

  it("las cauciones y los documentos siguen las mismas reglas", async () => {
    const { budget } = await setup();
    const reader = await createActor({ permissions: ["invoices_read"] });
    const writer = await createActor({ permissions: ["invoices_write"] });
    expect((await as(reader).post("/invoices/surety-bonds").send({ budget_id: budget.id, insurer: "A", policy_number: "P", amount: 1 })).status).toBe(401);
    expect((await as(writer).post("/invoices/surety-bonds").send({ budget_id: budget.id, insurer: "A", policy_number: "P", amount: 1 })).status).toBe(201);
    expect((await as(reader).post("/invoices/billing-files").send({ budget_id: budget.id })).status).toBe(401);
  });
});
