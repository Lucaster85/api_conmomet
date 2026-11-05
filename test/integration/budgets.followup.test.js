"use strict";
// Responsable del seguimiento de un presupuesto enviado (FLOWS.md §51): quien lo envía queda
// guardado en followup_user_id, aprobar/rechazar lo conservan, y GET /budgets?awaiting_response_for_me
// alimenta la tarjeta "Presupuestos esperando respuesta". Más el backfill de la migración.
const db = require("../../models");
const { createActor, as } = require("../helpers/auth");
const { createClient, createBudget } = require("../factories/budget");
const migration = require("../../migrations/20261104100002-budget-followup-user");

const SENDER_PERMS = ["budgets_update", "budgets_send", "budget_prices_read"];

async function draftBudget(creator, overrides = {}) {
  const client = await createClient();
  return createBudget({ clientId: client.id, createdBy: creator.user.id, ...overrides });
}

const send = (actor, budget) => as(actor).put(`/budgets/${budget.id}/status`).field("status", "sent");

describe("PUT /budgets/:id/status — responsable del seguimiento", () => {
  it("al enviar, followup_user_id queda en quien envía", async () => {
    const sender = await createActor({ permissions: SENDER_PERMS });
    const budget = await draftBudget(sender);

    const res = await send(sender, budget);

    expect(res.status).toBe(200);
    expect(res.body.data.followup_user_id).toBe(sender.user.id);
    expect(res.body.data.followupUser.id).toBe(sender.user.id);
    expect((await db.Budget.findByPk(budget.id)).followup_user_id).toBe(sender.user.id);
  });

  it("un presupuesto en borrador no tiene responsable", async () => {
    const creator = await createActor({ permissions: SENDER_PERMS });
    const budget = await draftBudget(creator);

    expect((await db.Budget.findByPk(budget.id)).followup_user_id).toBeNull();
  });

  it("aprobar conserva al responsable aunque lo apruebe otra persona", async () => {
    const sender = await createActor({ permissions: SENDER_PERMS });
    const approver = await createActor({ permissions: ["budgets_update"] });
    const budget = await draftBudget(sender);
    await send(sender, budget);

    const res = await as(approver).put(`/budgets/${budget.id}/status`).field("status", "approved");

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("approved");
    expect(res.body.data.followup_user_id).toBe(sender.user.id);
    expect(res.body.data.approved_by).toBe(approver.user.id);
  });

  it("rechazar conserva al responsable", async () => {
    const sender = await createActor({ permissions: SENDER_PERMS });
    const rejector = await createActor({ permissions: ["budgets_update"] });
    const budget = await draftBudget(sender);
    await send(sender, budget);

    const res = await as(rejector).put(`/budgets/${budget.id}/status`).field("status", "rejected").field("rejection_reason", "Caro");

    expect(res.status).toBe(200);
    expect(res.body.data.followup_user_id).toBe(sender.user.id);
  });

  it("sin budgets_send no envía y no se asigna responsable", async () => {
    const actor = await createActor({ permissions: ["budgets_update", "budget_prices_read"] });
    const budget = await draftBudget(actor);

    const res = await send(actor, budget);

    expect(res.status).toBe(403);
    expect((await db.Budget.findByPk(budget.id)).followup_user_id).toBeNull();
  });

  it("un admin (admin_granted) también queda como responsable", async () => {
    const admin = await createActor({ role: "admin" });
    const budget = await draftBudget(admin);

    const res = await send(admin, budget);

    expect(res.status).toBe(200);
    expect(res.body.data.followup_user_id).toBe(admin.user.id);
  });
});

describe("GET /budgets?awaiting_response_for_me=true", () => {
  it("devuelve solo los enviados cuyo seguimiento es mío", async () => {
    const yo = await createActor({ permissions: [...SENDER_PERMS, "budgets_read"] });
    const otro = await createActor({ permissions: SENDER_PERMS });

    const mioEnviado = await draftBudget(yo);
    await send(yo, mioEnviado);
    const mioAprobado = await draftBudget(yo);
    await send(yo, mioAprobado);
    await as(yo).put(`/budgets/${mioAprobado.id}/status`).field("status", "approved");
    const mioRechazado = await draftBudget(yo);
    await send(yo, mioRechazado);
    await as(yo).put(`/budgets/${mioRechazado.id}/status`).field("status", "rejected").field("rejection_reason", "No");
    const mioBorrador = await draftBudget(yo);
    const deOtro = await draftBudget(otro);
    await send(otro, deOtro);

    const res = await as(yo).get("/budgets?awaiting_response_for_me=true");

    expect(res.status).toBe(200);
    expect(res.body.data.map((b) => b.id)).toEqual([mioEnviado.id]);
    expect(mioBorrador.id).not.toBe(mioEnviado.id);
  });

  it("no se deja pisar por un status distinto en la query", async () => {
    const yo = await createActor({ permissions: [...SENDER_PERMS, "budgets_read"] });
    const budget = await draftBudget(yo);
    await send(yo, budget);
    await as(yo).put(`/budgets/${budget.id}/status`).field("status", "approved");

    const res = await as(yo).get("/budgets?awaiting_response_for_me=true&status=approved");

    expect(res.body.data).toHaveLength(0);
  });

  it("sin el filtro devuelve todos", async () => {
    const yo = await createActor({ permissions: ["budgets_read", ...SENDER_PERMS] });
    await draftBudget(yo);
    await draftBudget(yo);

    const res = await as(yo).get("/budgets");

    expect(res.body.data).toHaveLength(2);
  });
});

describe("migración 20261104100002 — backfill desde la auditoría", () => {
  const audit = (budgetId, userId, newValue = "sent", createdAt) =>
    db.AuditLog.create({
      entity_type: "Budget", entity_id: budgetId, action: "update", field_changed: "status",
      previous_value: "draft", new_value: newValue, performed_by: userId,
      ...(createdAt ? { created_at: createdAt } : {}),
    });

  it("toma el performed_by del último status → sent; sin auditoría queda sin responsable", async () => {
    const creator = await createActor();
    const sender = await createActor();
    const later = await createActor();

    const conAuditoria = await draftBudget(creator, { status: "sent" });
    await audit(conAuditoria.id, sender.user.id, "sent", new Date("2026-10-01T10:00:00Z"));
    await audit(conAuditoria.id, later.user.id, "sent", new Date("2026-10-02T10:00:00Z"));
    // Un cambio a otro estado no cuenta.
    await audit(conAuditoria.id, creator.user.id, "approved", new Date("2026-10-03T10:00:00Z"));
    const sinAuditoria = await draftBudget(creator, { status: "sent" });
    const yaAprobado = await draftBudget(creator, { status: "approved" });
    await audit(yaAprobado.id, sender.user.id);
    const yaTenia = await draftBudget(creator, { status: "sent", followup_user_id: creator.user.id });
    await audit(yaTenia.id, sender.user.id);

    await migration.backfillFollowupUsers(db.sequelize.getQueryInterface());

    expect((await db.Budget.findByPk(conAuditoria.id)).followup_user_id).toBe(later.user.id);
    expect((await db.Budget.findByPk(sinAuditoria.id)).followup_user_id).toBeNull();
    // Solo los que hoy están en "sent": los demás no se tocan.
    expect((await db.Budget.findByPk(yaAprobado.id)).followup_user_id).toBeNull();
    // Y no pisa un responsable ya cargado.
    expect((await db.Budget.findByPk(yaTenia.id)).followup_user_id).toBe(creator.user.id);
  });
});
