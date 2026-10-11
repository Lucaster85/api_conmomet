"use strict";
// Etapa 2 del plan de edición concurrente de Presupuestos (ver FLOWS.md §35): presencia vía
// PUT /budgets/:id/edit-session, el heartbeat que llama el diálogo de edición cada 30s.
const { createActor, as } = require("../helpers/auth");
const { createBudgetFixture } = require("../factories/budget");

describe("PUT /budgets/:id/edit-session (Etapa 2: presencia)", () => {
  it("el primer heartbeat crea la sesión y devuelve editors: []", async () => {
    const admin = await createActor({ role: "admin" });
    const { budget } = await createBudgetFixture({ actorUserId: admin.user.id });

    const res = await as(admin).put(`/budgets/${budget.id}/edit-session`).send({});
    expect(res.status).toBe(200);
    expect(res.body.editors).toEqual([]);
    expect(res.body.revision).toBe(0);
  });

  it("con dos usuarios, cada uno ve al otro en editors y no a sí mismo", async () => {
    const admin = await createActor({ role: "admin" });
    const other = await createActor({ permissions: ["budgets_read", "budgets_update"] });
    const { budget } = await createBudgetFixture({ actorUserId: admin.user.id });

    await as(admin).put(`/budgets/${budget.id}/edit-session`).send({});
    const resOther = await as(other).put(`/budgets/${budget.id}/edit-session`).send({});
    expect(resOther.body.editors.map((e) => e.user_id)).toEqual([admin.user.id]);

    const resAdminAgain = await as(admin).put(`/budgets/${budget.id}/edit-session`).send({});
    expect(resAdminAgain.body.editors.map((e) => e.user_id)).toEqual([other.user.id]);
  });

  it("una sesión con last_seen_at de más de 90s no aparece en editors", async () => {
    const db = require("../../models");
    const admin = await createActor({ role: "admin" });
    const other = await createActor({ permissions: ["budgets_read", "budgets_update"] });
    const { budget } = await createBudgetFixture({ actorUserId: admin.user.id });

    await db.EditSession.create({
      entity_type: "Budget",
      entity_id: budget.id,
      user_id: other.user.id,
      last_seen_at: new Date(Date.now() - 120 * 1000), // 120s, más de la ventana de 90s
    });

    const res = await as(admin).put(`/budgets/${budget.id}/edit-session`).send({});
    expect(res.body.editors).toEqual([]);
  });

  it("{ release: true } saca al usuario de editors", async () => {
    const admin = await createActor({ role: "admin" });
    const other = await createActor({ permissions: ["budgets_read", "budgets_update"] });
    const { budget } = await createBudgetFixture({ actorUserId: admin.user.id });

    await as(other).put(`/budgets/${budget.id}/edit-session`).send({});
    let res = await as(admin).put(`/budgets/${budget.id}/edit-session`).send({});
    expect(res.body.editors.map((e) => e.user_id)).toEqual([other.user.id]);

    await as(other).put(`/budgets/${budget.id}/edit-session`).send({ release: true });
    res = await as(admin).put(`/budgets/${budget.id}/edit-session`).send({});
    expect(res.body.editors).toEqual([]);
  });

  it("heartbeats repetidos no duplican filas (el índice único)", async () => {
    const db = require("../../models");
    const admin = await createActor({ role: "admin" });
    const { budget } = await createBudgetFixture({ actorUserId: admin.user.id });

    await as(admin).put(`/budgets/${budget.id}/edit-session`).send({});
    await as(admin).put(`/budgets/${budget.id}/edit-session`).send({});
    await as(admin).put(`/budgets/${budget.id}/edit-session`).send({});

    const count = await db.EditSession.count({ where: { entity_type: "Budget", entity_id: budget.id, user_id: admin.user.id } });
    expect(count).toBe(1);
  });

  it("devuelve el revision actual, que es lo que dispara el aviso rojo", async () => {
    const admin = await createActor({ role: "admin" });
    const { budget } = await createBudgetFixture({ actorUserId: admin.user.id });

    await as(admin).put(`/budgets/${budget.id}`).send({ revision: 0, title: "Cambio" });

    const res = await as(admin).put(`/budgets/${budget.id}/edit-session`).send({});
    expect(res.body.revision).toBe(1);
    expect(res.body.last_edited_by.id).toBe(admin.user.id);
  });

  it("401 sin budgets_update, 200 con admin_granted", async () => {
    const admin = await createActor({ role: "admin" });
    const readOnly = await createActor({ permissions: ["budgets_read"] });
    const { budget } = await createBudgetFixture({ actorUserId: admin.user.id });

    const resDenied = await as(readOnly).put(`/budgets/${budget.id}/edit-session`).send({});
    expect(resDenied.status).toBe(401);

    const resAllowed = await as(admin).put(`/budgets/${budget.id}/edit-session`).send({});
    expect(resAllowed.status).toBe(200);
  });
});
