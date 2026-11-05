"use strict";
// PUT /additionals/:id/finish ("Notificar finalización", FLOWS.md §50) y el filtro
// GET /additionals?pending_budget_for_me=true que alimenta la tarjeta del tablero.
const db = require("../../models");
const { createActor, as } = require("../helpers/auth");
const { createClient, createBudget } = require("../factories/budget");

let counter = 0;

async function createAdditional({ creator, status = "active", budgetStatus = "draft", ...overrides } = {}) {
  counter += 1;
  const client = await createClient();
  const project = await db.Project.create({
    name: `Adicional Test ${counter}`,
    code: `A-TEST-${String(counter).padStart(3, "0")}-${Math.floor(Math.random() * 1e6)}`,
    client_id: client.id,
    is_additional: true,
    status,
    start_date: "2026-11-01",
    ...overrides,
  });
  const budget = await createBudget({
    clientId: client.id,
    createdBy: creator.user.id,
    status: budgetStatus,
    project_id: project.id,
  });
  return { project, budget, client };
}

// notify() es fire-and-forget (no se espera): se espera a que aparezcan las filas.
async function waitForNotifications(where, expected) {
  for (let i = 0; i < 40; i += 1) {
    const rows = await db.Notification.findAll({ where });
    if (rows.length >= expected) return rows;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return db.Notification.findAll({ where });
}

describe("PUT /additionals/:id/finish", () => {
  it("pasa el adicional a Completado, fija end_date, guarda responsables y avisa solo a ellos", async () => {
    const actor = await createActor({ permissions: ["additionals_update"] });
    const gerenteA = await createActor({ permissions: ["budgets_send"] });
    const gerenteB = await createActor({ permissions: ["budgets_send"] });
    const { project } = await createAdditional({ creator: actor });

    const res = await as(actor).put(`/additionals/${project.id}/finish`).send({ assignee_ids: [gerenteA.user.id, gerenteB.user.id] });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("completed");
    expect(res.body.data.end_date).toBeTruthy();
    expect(res.body.data.finish_notified_at).toBeTruthy();
    expect(res.body.data.budgetAssignees.map((u) => u.id).sort()).toEqual([gerenteA.user.id, gerenteB.user.id].sort());

    const reloaded = await db.Project.findByPk(project.id);
    expect(reloaded.status).toBe("completed");
    expect(reloaded.finish_notified_by).toBe(actor.user.id);

    const audit = await db.AuditLog.findOne({ where: { entity_type: "Project", entity_id: project.id, field_changed: "status" } });
    expect(audit.previous_value).toBe("active");
    expect(audit.new_value).toBe("completed");

    const notifs = await waitForNotifications({ type: "additional_finished" }, 2);
    expect(notifs.map((n) => n.user_id).sort()).toEqual([gerenteA.user.id, gerenteB.user.id].sort());
    expect(notifs[0].url).toBe(`/dashboard/additionals/${project.id}`);
    expect(notifs[0].entity_id).toBe(project.id);
  });

  it("conserva el end_date que ya tenía", async () => {
    const actor = await createActor({ permissions: ["additionals_update"] });
    const gerente = await createActor({ permissions: ["budgets_send"] });
    const { project } = await createAdditional({ creator: actor, end_date: "2026-11-02" });

    const res = await as(actor).put(`/additionals/${project.id}/finish`).send({ assignee_ids: [gerente.user.id] });

    expect(res.status).toBe(200);
    expect(res.body.data.end_date).toBe("2026-11-02");
  });

  it("no se avisa a sí mismo si quien notifica es uno de los responsables", async () => {
    const actor = await createActor({ permissions: ["additionals_update", "budgets_send"] });
    const gerente = await createActor({ permissions: ["budgets_send"] });
    const { project } = await createAdditional({ creator: actor });

    const res = await as(actor).put(`/additionals/${project.id}/finish`).send({ assignee_ids: [actor.user.id, gerente.user.id] });

    expect(res.status).toBe(200);
    expect(res.body.data.budgetAssignees).toHaveLength(2);
    await waitForNotifications({ type: "additional_finished" }, 1);
    const notifs = await db.Notification.findAll({ where: { type: "additional_finished" } });
    expect(notifs.map((n) => n.user_id)).toEqual([gerente.user.id]);
  });

  it("rechaza sin responsables (400)", async () => {
    const actor = await createActor({ permissions: ["additionals_update"] });
    const { project } = await createAdditional({ creator: actor });

    const empty = await as(actor).put(`/additionals/${project.id}/finish`).send({ assignee_ids: [] });
    const missing = await as(actor).put(`/additionals/${project.id}/finish`).send({});

    expect(empty.status).toBe(400);
    expect(missing.status).toBe(400);
    expect((await db.Project.findByPk(project.id)).status).toBe("active");
  });

  it("rechaza a un responsable sin budgets_send (400) y no cambia nada", async () => {
    const actor = await createActor({ permissions: ["additionals_update"] });
    const gerente = await createActor({ permissions: ["budgets_send"] });
    const operario = await createActor({ permissions: ["additionals_read"] });
    const { project } = await createAdditional({ creator: actor });

    const res = await as(actor).put(`/additionals/${project.id}/finish`).send({ assignee_ids: [gerente.user.id, operario.user.id] });

    expect(res.status).toBe(400);
    const reloaded = await db.Project.findByPk(project.id);
    expect(reloaded.status).toBe("active");
    expect(reloaded.finish_notified_at).toBeNull();
    expect(await project.countBudgetAssignees()).toBe(0);
    expect(await db.Notification.count()).toBe(0);
  });

  it("rechaza un id de usuario inexistente (400)", async () => {
    const actor = await createActor({ permissions: ["additionals_update"] });
    const { project } = await createAdditional({ creator: actor });

    const res = await as(actor).put(`/additionals/${project.id}/finish`).send({ assignee_ids: [999999] });

    expect(res.status).toBe(400);
  });

  it("acepta como responsable a un admin (admin_granted)", async () => {
    const actor = await createActor({ permissions: ["additionals_update"] });
    const admin = await createActor({ role: "admin" });
    const { project } = await createAdditional({ creator: actor });

    const res = await as(actor).put(`/additionals/${project.id}/finish`).send({ assignee_ids: [admin.user.id] });

    expect(res.status).toBe(200);
  });

  it("devuelve 409 si el presupuesto ya fue enviado", async () => {
    const actor = await createActor({ permissions: ["additionals_update"] });
    const gerente = await createActor({ permissions: ["budgets_send"] });
    const { project } = await createAdditional({ creator: actor, budgetStatus: "sent" });

    const res = await as(actor).put(`/additionals/${project.id}/finish`).send({ assignee_ids: [gerente.user.id] });

    expect(res.status).toBe(409);
    expect((await db.Project.findByPk(project.id)).status).toBe("active");
  });

  it("rechaza un adicional cancelado (400)", async () => {
    const actor = await createActor({ permissions: ["additionals_update"] });
    const gerente = await createActor({ permissions: ["budgets_send"] });
    const { project } = await createAdditional({ creator: actor, status: "cancelled" });

    const res = await as(actor).put(`/additionals/${project.id}/finish`).send({ assignee_ids: [gerente.user.id] });

    expect(res.status).toBe(400);
    expect((await db.Project.findByPk(project.id)).status).toBe("cancelled");
  });

  it("devuelve 404 si el proyecto no es un adicional", async () => {
    const actor = await createActor({ permissions: ["additionals_update"] });
    const gerente = await createActor({ permissions: ["budgets_send"] });
    const { project } = await createAdditional({ creator: actor, is_additional: false });

    const res = await as(actor).put(`/additionals/${project.id}/finish`).send({ assignee_ids: [gerente.user.id] });

    expect(res.status).toBe(404);
  });

  it("al volver a llamarlo reemplaza el set de responsables, vuelve a avisar y no duplica la auditoría", async () => {
    const actor = await createActor({ permissions: ["additionals_update"] });
    const gerenteA = await createActor({ permissions: ["budgets_send"] });
    const gerenteB = await createActor({ permissions: ["budgets_send"] });
    const { project } = await createAdditional({ creator: actor });

    await as(actor).put(`/additionals/${project.id}/finish`).send({ assignee_ids: [gerenteA.user.id] });
    const firstNotifiedAt = (await db.Project.findByPk(project.id)).finish_notified_at;
    await new Promise((resolve) => setTimeout(resolve, 1100)); // finish_notified_at tiene precisión de segundos
    const res = await as(actor).put(`/additionals/${project.id}/finish`).send({ assignee_ids: [gerenteB.user.id] });

    expect(res.status).toBe(200);
    expect(res.body.data.budgetAssignees.map((u) => u.id)).toEqual([gerenteB.user.id]);
    expect(new Date(res.body.data.finish_notified_at).getTime()).toBeGreaterThan(new Date(firstNotifiedAt).getTime());

    const notifsB = await waitForNotifications({ type: "additional_finished", user_id: gerenteB.user.id }, 1);
    expect(notifsB).toHaveLength(1);
    expect(await db.AuditLog.count({ where: { entity_type: "Project", entity_id: project.id, field_changed: "status" } })).toBe(1);
  });

  it("permite notificar un adicional que ya estaba Completado desde la edición (sin responsables)", async () => {
    const actor = await createActor({ permissions: ["additionals_update"] });
    const gerente = await createActor({ permissions: ["budgets_send"] });
    const { project } = await createAdditional({ creator: actor, status: "completed" });

    const res = await as(actor).put(`/additionals/${project.id}/finish`).send({ assignee_ids: [gerente.user.id] });

    expect(res.status).toBe(200);
    expect(res.body.data.budgetAssignees).toHaveLength(1);
  });

  describe("permisos", () => {
    it("403/401 sin additionals_update", async () => {
      const reader = await createActor({ permissions: ["additionals_read"] });
      const gerente = await createActor({ permissions: ["budgets_send"] });
      const { project } = await createAdditional({ creator: reader });

      const res = await as(reader).put(`/additionals/${project.id}/finish`).send({ assignee_ids: [gerente.user.id] });

      expect([401, 403]).toContain(res.status);
      expect((await db.Project.findByPk(project.id)).status).toBe("active");
    });

    it("pasa con additionals_update exacto", async () => {
      const actor = await createActor({ permissions: ["additionals_update"] });
      const gerente = await createActor({ permissions: ["budgets_send"] });
      const { project } = await createAdditional({ creator: actor });

      const res = await as(actor).put(`/additionals/${project.id}/finish`).send({ assignee_ids: [gerente.user.id] });

      expect(res.status).toBe(200);
    });

    it("pasa con admin_granted (bypass)", async () => {
      const admin = await createActor({ role: "admin" });
      const gerente = await createActor({ permissions: ["budgets_send"] });
      const { project } = await createAdditional({ creator: admin });

      const res = await as(admin).put(`/additionals/${project.id}/finish`).send({ assignee_ids: [gerente.user.id] });

      expect(res.status).toBe(200);
    });
  });
});

describe("GET /additionals?pending_budget_for_me=true", () => {
  it("devuelve solo los completados, con presupuesto en borrador, donde soy responsable", async () => {
    const actor = await createActor({ permissions: ["additionals_update", "additionals_read"] });
    const yo = await createActor({ permissions: ["additionals_read", "budgets_send"] });
    const otro = await createActor({ permissions: ["additionals_read", "budgets_send"] });

    const mio = await createAdditional({ creator: actor });
    const deOtro = await createAdditional({ creator: actor });
    const sinResponsables = await createAdditional({ creator: actor, status: "completed" });
    const activo = await createAdditional({ creator: actor });
    const yaEnviado = await createAdditional({ creator: actor });

    await as(actor).put(`/additionals/${mio.project.id}/finish`).send({ assignee_ids: [yo.user.id, otro.user.id] });
    await as(actor).put(`/additionals/${deOtro.project.id}/finish`).send({ assignee_ids: [otro.user.id] });
    // "activo": tiene responsables pero se reabrió desde la edición.
    await as(actor).put(`/additionals/${activo.project.id}/finish`).send({ assignee_ids: [yo.user.id] });
    await db.Project.update({ status: "active" }, { where: { id: activo.project.id } });
    // "yaEnviado": se notificó y después el presupuesto salió.
    await as(actor).put(`/additionals/${yaEnviado.project.id}/finish`).send({ assignee_ids: [yo.user.id] });
    await yaEnviado.budget.update({ status: "sent", sent_at: new Date() });

    const res = await as(yo).get("/additionals?pending_budget_for_me=true");

    expect(res.status).toBe(200);
    expect(res.body.data.map((p) => p.id)).toEqual([mio.project.id]);
    // No recorta el array de responsables a quien matcheó.
    expect(res.body.data[0].budgetAssignees).toHaveLength(2);
    expect(res.body.data[0].finish_notified_at).toBeTruthy();
    expect(sinResponsables.project.id).not.toBe(mio.project.id);
  });

  it("sin el filtro devuelve todos los adicionales", async () => {
    const actor = await createActor({ permissions: ["additionals_read"] });
    await createAdditional({ creator: actor });
    await createAdditional({ creator: actor });

    const res = await as(actor).get("/additionals");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });
});

describe("GET /lookup/budget-managers", () => {
  it("lista solo a gerencia (budgets_send o admin) con id y nombre, sin exigir users_read", async () => {
    const actor = await createActor({ permissions: ["additionals_update"] });
    const gerente = await createActor({ permissions: ["budgets_send"] });
    const admin = await createActor({ role: "admin" });
    await createActor({ permissions: ["budgets_read"] });

    const res = await as(actor).get("/lookup/budget-managers");

    expect(res.status).toBe(200);
    expect(res.body.data.map((u) => u.id).sort()).toEqual([gerente.user.id, admin.user.id].sort());
    expect(Object.keys(res.body.data[0]).sort()).toEqual(["id", "lastname", "name"]);
  });
});
