"use strict";
// N° de presupuesto del cliente (FLOWS.md §79): el número con el que el CLIENTE identifica nuestro
// presupuesto (lo referencian sus OC). Se carga opcionalmente al enviar, o después —solo si está
// vacío— con PUT /budgets/:id/client-budget-number. Se busca desde Presupuestos y desde PC.
// Distinto de QuoteRequest.client_quote_number (identifica el pedido, vive en la PC: §27b).
const db = require("../../models");
const { createActor, as } = require("../helpers/auth");
const { createClient, createBudget } = require("../factories/budget");

const SENDER_PERMS = ["budgets_update", "budgets_send", "budget_prices_read"];

async function budgetFor(creator, overrides = {}) {
  const client = await createClient();
  return createBudget({ clientId: client.id, createdBy: creator.user.id, ...overrides });
}

// Contador y no Math.random(): un número al azar podría contener por casualidad el texto que busca el test.
let quoteRequestCounter = 0;
async function quoteRequestFor(creator, overrides = {}) {
  const client = await createClient();
  quoteRequestCounter += 1;
  const n = quoteRequestCounter;
  return db.QuoteRequest.create({
    number: `PC-TEST-${n}`,
    title: `PC Test ${n}`,
    client_quote_number: `CQ-${n}`,
    client_id: client.id,
    due_date: "2030-01-01",
    created_by: creator.user.id,
    ...overrides,
  });
}

const sendWith = (actor, budget, number) => {
  const req = as(actor).put(`/budgets/${budget.id}/status`).field("status", "sent");
  return number === undefined ? req : req.field("client_budget_number", number);
};

const auditEntries = (budget) =>
  db.AuditLog.findAll({ where: { entity_type: "Budget", entity_id: budget.id, field_changed: "client_budget_number" } });

describe("PUT /budgets/:id/status — N° de presupuesto del cliente al enviar", () => {
  it("al enviar con número lo guarda recortado y deja el cambio en el historial", async () => {
    const sender = await createActor({ permissions: SENDER_PERMS });
    const budget = await budgetFor(sender);

    const res = await sendWith(sender, budget, "  4500-77/A  ");

    expect(res.status).toBe(200);
    expect(res.body.data.client_budget_number).toBe("4500-77/A");
    expect((await db.Budget.findByPk(budget.id)).client_budget_number).toBe("4500-77/A");
    const [entry] = await auditEntries(budget);
    expect(entry.new_value).toBe("4500-77/A");
    expect(entry.performed_by).toBe(sender.user.id);
  });

  it("enviar sin número es válido y no deja nada cargado ni en el historial", async () => {
    const sender = await createActor({ permissions: SENDER_PERMS });
    const budget = await budgetFor(sender);

    const res = await sendWith(sender, budget);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("sent");
    expect(res.body.data.client_budget_number).toBeNull();
    expect(await auditEntries(budget)).toHaveLength(0);
  });

  it("un número en blanco se trata como vacío", async () => {
    const sender = await createActor({ permissions: SENDER_PERMS });
    const budget = await budgetFor(sender);

    const res = await sendWith(sender, budget, "   ");

    expect(res.status).toBe(200);
    expect(res.body.data.client_budget_number).toBeNull();
  });

  it("un número de más de 100 caracteres da 400 y el presupuesto sigue en borrador", async () => {
    const sender = await createActor({ permissions: SENDER_PERMS });
    const budget = await budgetFor(sender);

    const res = await sendWith(sender, budget, "x".repeat(101));

    expect(res.status).toBe(400);
    expect((await db.Budget.findByPk(budget.id)).status).toBe("draft");
  });

  it("el número solo se toma al enviar: al aprobar se ignora", async () => {
    const sender = await createActor({ permissions: SENDER_PERMS });
    const budget = await budgetFor(sender);
    await sendWith(sender, budget);

    const res = await as(sender).put(`/budgets/${budget.id}/status`).field("status", "approved").field("client_budget_number", "NO-DEBE-GUARDARSE");

    expect(res.status).toBe(200);
    expect(res.body.data.client_budget_number).toBeNull();
  });
});

describe("PUT /budgets/:id/client-budget-number — carga posterior", () => {
  it("en un presupuesto enviado sin número lo carga y lo deja en el historial", async () => {
    const actor = await createActor({ permissions: ["budgets_update"] });
    const budget = await budgetFor(actor, { status: "sent" });

    const res = await as(actor).put(`/budgets/${budget.id}/client-budget-number`).send({ client_budget_number: " 2026-0451 " });

    expect(res.status).toBe(200);
    expect(res.body.data.client_budget_number).toBe("2026-0451");
    const [entry] = await auditEntries(budget);
    expect(entry.new_value).toBe("2026-0451");
  });

  it.each(["approved", "rejected"])("también funciona en un presupuesto %s", async (status) => {
    const actor = await createActor({ permissions: ["budgets_update"] });
    const budget = await budgetFor(actor, { status });

    const res = await as(actor).put(`/budgets/${budget.id}/client-budget-number`).send({ client_budget_number: "X-1" });

    expect(res.status).toBe(200);
  });

  it("en borrador da 400: ahí se carga al enviar", async () => {
    const actor = await createActor({ permissions: ["budgets_update"] });
    const budget = await budgetFor(actor);

    const res = await as(actor).put(`/budgets/${budget.id}/client-budget-number`).send({ client_budget_number: "X-1" });

    expect(res.status).toBe(400);
    expect((await db.Budget.findByPk(budget.id)).client_budget_number).toBeNull();
  });

  it("si ya tiene número da 400 y no lo pisa", async () => {
    const actor = await createActor({ permissions: ["budgets_update"] });
    const budget = await budgetFor(actor, { status: "sent", client_budget_number: "ORIGINAL" });

    const res = await as(actor).put(`/budgets/${budget.id}/client-budget-number`).send({ client_budget_number: "OTRO" });

    expect(res.status).toBe(400);
    expect((await db.Budget.findByPk(budget.id)).client_budget_number).toBe("ORIGINAL");
  });

  it("vacío o de más de 100 caracteres da 400", async () => {
    const actor = await createActor({ permissions: ["budgets_update"] });
    const budget = await budgetFor(actor, { status: "sent" });

    for (const value of ["", "   ", undefined, "x".repeat(101)]) {
      const res = await as(actor).put(`/budgets/${budget.id}/client-budget-number`).send({ client_budget_number: value });
      expect(res.status).toBe(400);
    }
  });

  it("un presupuesto inexistente da 404", async () => {
    const actor = await createActor({ permissions: ["budgets_update"] });
    const res = await as(actor).put("/budgets/999999/client-budget-number").send({ client_budget_number: "X-1" });
    expect(res.status).toBe(404);
  });

  // authPermission responde 401 ("forbidden") cuando falta el permiso de la ruta — igual que budgets.history/editSession.
  it("sin budgets_update se rechaza (401) y con admin_granted pasa", async () => {
    const owner = await createActor({ permissions: ["budgets_update"] });
    const budget = await budgetFor(owner, { status: "sent" });
    const reader = await createActor({ permissions: ["budgets_read"] });
    const admin = await createActor({ role: "admin" });

    const denied = await as(reader).put(`/budgets/${budget.id}/client-budget-number`).send({ client_budget_number: "X-1" });
    expect(denied.status).toBe(401);
    expect((await db.Budget.findByPk(budget.id)).client_budget_number).toBeNull();

    const allowed = await as(admin).put(`/budgets/${budget.id}/client-budget-number`).send({ client_budget_number: "X-1" });
    expect(allowed.status).toBe(200);
  });
});

describe("GET /budgets?q= — búsqueda por número del cliente", () => {
  it("encuentra por el N° de presupuesto del cliente", async () => {
    const actor = await createActor({ permissions: ["budgets_read"] });
    const target = await budgetFor(actor, { status: "sent", client_budget_number: "ZZ-8841-A" });
    await budgetFor(actor, { status: "sent", client_budget_number: "OTRO-1" });

    const res = await as(actor).get("/budgets").query({ q: "8841" });

    expect(res.status).toBe(200);
    expect(res.body.data.map((b) => b.id)).toEqual([target.id]);
  });

  it("encuentra por el N° de cotización del cliente que vive en la PC (pendiente de §27b)", async () => {
    const actor = await createActor({ permissions: ["budgets_read"] });
    const qr = await quoteRequestFor(actor, { client_quote_number: "COT-CLI-5521" });
    const target = await budgetFor(actor, { status: "sent", quote_request_id: qr.id });
    await budgetFor(actor, { status: "sent" });

    const res = await as(actor).get("/budgets").query({ q: "5521" });

    expect(res.status).toBe(200);
    expect(res.body.data.map((b) => b.id)).toEqual([target.id]);
  });

  it("sigue buscando por lo de siempre: número propio y título", async () => {
    const actor = await createActor({ permissions: ["budgets_read"] });
    const budget = await budgetFor(actor, { status: "sent", title: "Montaje línea única" });

    const byNumber = await as(actor).get("/budgets").query({ q: budget.number });
    const byTitle = await as(actor).get("/budgets").query({ q: "línea única" });

    expect(byNumber.body.data.map((b) => b.id)).toContain(budget.id);
    expect(byTitle.body.data.map((b) => b.id)).toContain(budget.id);
  });
});

describe("GET /quote-requests?q= — búsqueda por el número del presupuesto", () => {
  it("encuentra la PC cuyo presupuesto tiene ese número y devuelve todos sus presupuestos", async () => {
    const actor = await createActor({ permissions: ["quote_requests_read"] });
    const qr = await quoteRequestFor(actor);
    const other = await quoteRequestFor(actor);
    const matching = await budgetFor(actor, { status: "sent", quote_request_id: qr.id, client_budget_number: "PRESCLI-9937" });
    const sibling = await budgetFor(actor, { status: "rejected", quote_request_id: qr.id });
    await budgetFor(actor, { status: "sent", quote_request_id: other.id, client_budget_number: "NADA" });

    const res = await as(actor).get("/quote-requests").query({ q: "9937", include_closed: "true" });

    expect(res.status).toBe(200);
    expect(res.body.data.map((r) => r.id)).toEqual([qr.id]);
    const budgets = res.body.data[0].budgets;
    expect(budgets.map((b) => b.id).sort()).toEqual([matching.id, sibling.id].sort());
    expect(budgets.find((b) => b.id === matching.id).client_budget_number).toBe("PRESCLI-9937");
  });

  it("no considera presupuestos borrados", async () => {
    const actor = await createActor({ permissions: ["quote_requests_read"] });
    const qr = await quoteRequestFor(actor);
    const budget = await budgetFor(actor, { status: "sent", quote_request_id: qr.id, client_budget_number: "BORRADO-7712" });
    await budget.destroy();

    const res = await as(actor).get("/quote-requests").query({ q: "7712" });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

describe("POST /budgets/:id/duplicate — el número del cliente es por presupuesto", () => {
  it("el duplicado no hereda el N° del cliente", async () => {
    const actor = await createActor({ permissions: ["budgets_write", "budgets_read"] });
    const budget = await budgetFor(actor, { status: "rejected", client_budget_number: "ORIG-1" });

    const res = await as(actor).post(`/budgets/${budget.id}/duplicate`).send({});

    expect(res.status).toBe(201);
    const copy = await db.Budget.findByPk(res.body.data.id);
    expect(copy.client_budget_number).toBeNull();
  });
});
