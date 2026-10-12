"use strict";
// Etapa 2 del plan de edición concurrente de Presupuestos (ver FLOWS.md §35): candado de
// edición. El primero que llama a PUT /budgets/:id/edit-session lo toma; cualquier otro lo
// recibe en `locked_by`, sin crear su propia sesión. Sin TTL a propósito (por ahora): queda
// tomado hasta que quien lo tiene libera (guarda o { release: true }).
const db = require("../../models");
const { createActor, as } = require("../helpers/auth");
const { createBudgetFixture } = require("../factories/budget");

describe("PUT /budgets/:id/edit-session (Etapa 2: candado)", () => {
  it("el primer heartbeat toma el candado y devuelve locked_by: null", async () => {
    const admin = await createActor({ role: "admin" });
    const { budget } = await createBudgetFixture({ actorUserId: admin.user.id });

    const res = await as(admin).put(`/budgets/${budget.id}/edit-session`).send({});
    expect(res.status).toBe(200);
    expect(res.body.locked_by).toBeNull();
    expect(res.body.revision).toBe(0);
  });

  it("con dos usuarios, el segundo recibe quién lo tiene y no le crea su propia sesión", async () => {
    const admin = await createActor({ role: "admin" });
    const other = await createActor({ permissions: ["budgets_read", "budgets_update"] });
    const { budget } = await createBudgetFixture({ actorUserId: admin.user.id });

    await as(admin).put(`/budgets/${budget.id}/edit-session`).send({});
    const resOther = await as(other).put(`/budgets/${budget.id}/edit-session`).send({});
    expect(resOther.body.locked_by.user_id).toBe(admin.user.id);

    const count = await db.EditSession.count({ where: { entity_type: "Budget", entity_id: budget.id } });
    expect(count).toBe(1); // solo la de admin — a other no se le creó ninguna.
  });

  it("el candado no expira por tiempo: sigue tomado aunque pase mucho rato sin heartbeats", async () => {
    const admin = await createActor({ role: "admin" });
    const other = await createActor({ permissions: ["budgets_read", "budgets_update"] });
    const { budget } = await createBudgetFixture({ actorUserId: admin.user.id });

    await db.EditSession.create({
      entity_type: "Budget",
      entity_id: budget.id,
      user_id: admin.user.id,
      last_seen_at: new Date(Date.now() - 60 * 60 * 1000), // hace 1 hora, sin heartbeats desde entonces
    });

    const res = await as(other).put(`/budgets/${budget.id}/edit-session`).send({});
    expect(res.body.locked_by.user_id).toBe(admin.user.id); // sigue bloqueado, no expiró.
  });

  it("{ release: true } libera el candado — otro usuario puede tomarlo después", async () => {
    const admin = await createActor({ role: "admin" });
    const other = await createActor({ permissions: ["budgets_read", "budgets_update"] });
    const { budget } = await createBudgetFixture({ actorUserId: admin.user.id });

    await as(admin).put(`/budgets/${budget.id}/edit-session`).send({});
    let res = await as(other).put(`/budgets/${budget.id}/edit-session`).send({});
    expect(res.body.locked_by.user_id).toBe(admin.user.id);

    await as(admin).put(`/budgets/${budget.id}/edit-session`).send({ release: true });
    res = await as(other).put(`/budgets/${budget.id}/edit-session`).send({});
    expect(res.body.locked_by).toBeNull(); // ahora other lo puede tomar.
  });

  it("heartbeats repetidos del mismo titular no duplican filas (el índice único)", async () => {
    const admin = await createActor({ role: "admin" });
    const { budget } = await createBudgetFixture({ actorUserId: admin.user.id });

    await as(admin).put(`/budgets/${budget.id}/edit-session`).send({});
    await as(admin).put(`/budgets/${budget.id}/edit-session`).send({});
    await as(admin).put(`/budgets/${budget.id}/edit-session`).send({});

    const count = await db.EditSession.count({ where: { entity_type: "Budget", entity_id: budget.id, user_id: admin.user.id } });
    expect(count).toBe(1);
  });

  it("devuelve el revision actual, que es lo que dispara el chequeo de guardado", async () => {
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
