"use strict";
// Etapa 2 del plan de edición concurrente de Presupuestos (ver FLOWS.md §35): control de
// concurrencia vía `revision` (409 budget_stale) y candado de edición (409 budget_locked).
// PUT /budgets/:id y PUT /additionals/:id/materials (el segundo camino de escritura sobre las
// mismas líneas) chequean ambos: el candado primero — alguien más editando bloquea el
// guardado aunque la revision coincida — y la revision como red de seguridad adicional.
const db = require("../../models");
const { createActor, as } = require("../helpers/auth");
const { createBudgetFixture, createBudgetItemType, createClient } = require("../factories/budget");

describe("PUT /budgets/:id — concurrencia (Etapa 2: revision)", () => {
  it("400 si el payload no trae revision", async () => {
    const admin = await createActor({ role: "admin" });
    const { budget } = await createBudgetFixture({ actorUserId: admin.user.id });

    const res = await as(admin).put(`/budgets/${budget.id}`).send({ title: "Nuevo título" });
    expect(res.status).toBe(400);
  });

  it("409 budget_stale con un revision viejo, y no se escribió nada", async () => {
    const admin = await createActor({ role: "admin" });
    const itemType = await createBudgetItemType();
    const { budget } = await createBudgetFixture({ actorUserId: admin.user.id });

    await as(admin).put(`/budgets/${budget.id}`).send({
      revision: 0,
      laborLines: [{ budget_item_type_id: itemType.id, quantity: 1, unit_price: 100, currency: "ARS" }],
    });

    // Reintenta con la MISMA revision vieja (0), como si nunca hubiera visto el guardado anterior.
    const res = await as(admin).put(`/budgets/${budget.id}`).send({
      revision: 0,
      laborLines: [{ budget_item_type_id: itemType.id, quantity: 2, unit_price: 200, currency: "ARS" }],
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("budget_stale");

    const lines = await db.BudgetLaborLine.findAll({ where: { budget_id: budget.id } });
    expect(lines).toHaveLength(1);
    expect(parseFloat(lines[0].quantity)).toBe(1); // la línea del segundo intento nunca se escribió.
  });

  it("el 409 trae current_revision, last_edited_by y last_edited_at", async () => {
    const admin = await createActor({ role: "admin" });
    const { budget } = await createBudgetFixture({ actorUserId: admin.user.id });

    await as(admin).put(`/budgets/${budget.id}`).send({ revision: 0, title: "Primer guardado" });

    const res = await as(admin).put(`/budgets/${budget.id}`).send({ revision: 0, title: "Segundo intento" });
    expect(res.status).toBe(409);
    expect(res.body.current_revision).toBe(1);
    expect(res.body.last_edited_by.id).toBe(admin.user.id);
    expect(res.body.last_edited_at).toBeTruthy();
  });

  it("un guardado exitoso incrementa revision en exactamente 1 y setea last_edited_by/last_edited_at", async () => {
    const admin = await createActor({ role: "admin" });
    const { budget } = await createBudgetFixture({ actorUserId: admin.user.id });

    const res = await as(admin).put(`/budgets/${budget.id}`).send({ revision: 0, title: "Título nuevo" });
    expect(res.status).toBe(200);
    expect(res.body.data.revision).toBe(1);

    const row = await db.Budget.findByPk(budget.id);
    expect(row.revision).toBe(1);
    expect(row.last_edited_by).toBe(admin.user.id);
    expect(row.last_edited_at).toBeTruthy();
  });

  it("el escenario A/B completo: A guarda, B con la revision vieja no pisa a A", async () => {
    const admin = await createActor({ role: "admin" });
    const { budget, material, provider, materialUnit } = await createBudgetFixture({ actorUserId: admin.user.id });

    // Los dos "abren" el presupuesto en revision 0.
    const resA = await as(admin).put(`/budgets/${budget.id}`).send({
      revision: 0,
      materialItems: [
        { material_id: material.id, provider_id: provider.id, description: "De A — uno", quantity: 1, material_unit_id: materialUnit.id, margin_percent: 0 },
        { material_id: material.id, provider_id: provider.id, description: "De A — dos", quantity: 1, material_unit_id: materialUnit.id, margin_percent: 0 },
      ],
    });
    expect(resA.status).toBe(200);

    // B, con el form armado antes de que A guardara, intenta guardar sus propias 2 líneas
    // también con revision: 0.
    const resB = await as(admin).put(`/budgets/${budget.id}`).send({
      revision: 0,
      materialItems: [
        { material_id: material.id, provider_id: provider.id, description: "De B — uno", quantity: 1, material_unit_id: materialUnit.id, margin_percent: 0 },
        { material_id: material.id, provider_id: provider.id, description: "De B — dos", quantity: 1, material_unit_id: materialUnit.id, margin_percent: 0 },
      ],
    });
    expect(resB.status).toBe(409);

    // Las 2 líneas de A siguen ahí, intactas.
    const afterB = await db.BudgetMaterialItem.findAll({ where: { budget_id: budget.id } });
    expect(afterB.map((i) => i.description).sort()).toEqual(["De A — dos", "De A — uno"]);

    // B recarga (toma la revision actual) y reintenta — ahora sí entra, sumándose a lo de A.
    const resB2 = await as(admin).put(`/budgets/${budget.id}`).send({
      revision: resA.body.data.revision,
      materialItems: [
        ...resA.body.data.materialItems.map((i) => ({ id: i.id, material_id: material.id, provider_id: provider.id, description: i.description, quantity: 1, material_unit_id: materialUnit.id, margin_percent: 0 })),
        { material_id: material.id, provider_id: provider.id, description: "De B — uno", quantity: 1, material_unit_id: materialUnit.id, margin_percent: 0 },
        { material_id: material.id, provider_id: provider.id, description: "De B — dos", quantity: 1, material_unit_id: materialUnit.id, margin_percent: 0 },
      ],
    });
    expect(resB2.status).toBe(200);
    expect(resB2.body.data.materialItems).toHaveLength(4);
  });

  it("409 budget_locked si otro usuario tiene el candado, aunque la revision coincida", async () => {
    const admin = await createActor({ role: "admin" });
    const other = await createActor({ permissions: ["budgets_read", "budgets_update"] });
    const { budget } = await createBudgetFixture({ actorUserId: admin.user.id });

    // admin abre "Editar" (toma el candado) y other intenta guardar directo, sin haberlo
    // adquirido — simula un cliente que llega a /budgets/:id sin pasar por edit-session.
    await as(admin).put(`/budgets/${budget.id}/edit-session`).send({});

    const res = await as(other).put(`/budgets/${budget.id}`).send({ revision: 0, title: "Intento de other" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("budget_locked");
    expect(res.body.locked_by.user_id).toBe(admin.user.id);

    const row = await db.Budget.findByPk(budget.id);
    expect(row.title).not.toBe("Intento de other");
  });

  it("el titular del candado sí puede guardar normalmente", async () => {
    const admin = await createActor({ role: "admin" });
    const { budget } = await createBudgetFixture({ actorUserId: admin.user.id });

    await as(admin).put(`/budgets/${budget.id}/edit-session`).send({});
    const res = await as(admin).put(`/budgets/${budget.id}`).send({ revision: 0, title: "Cambio del titular" });
    expect(res.status).toBe(200);
  });
});

describe("PUT /additionals/:id/materials — concurrencia (Etapa 2: segundo camino de escritura)", () => {
  async function createAdditionalFixture(actorUserId) {
    const { Project, Budget } = db;
    const client = await createClient();
    // number/code son STRING(30) — un sufijo con Date.now() + random se pasa del límite.
    const suffix = Math.random().toString(36).slice(2, 10);
    const project = await Project.create({
      name: "Adicional de test",
      code: `ADI-${suffix}`,
      client_id: client.id,
      is_additional: true,
      start_date: new Date(),
    });
    const budget = await Budget.create({
      number: `PRES-${suffix}`,
      title: project.name,
      client_id: client.id,
      project_id: project.id,
      status: "draft",
      created_by: actorUserId,
    });
    return { project, budget };
  }

  it("GET /additionals/:id sirve current_budget.revision como número — regresión del bug 'Falta revision'", async () => {
    // projectInclude restringe los `attributes` del Budget incluido: si revision/
    // last_edited_by/last_edited_at no están en esa whitelist, Sequelize nunca las trae,
    // budgetSummary() las sirve undefined, y el frontend termina mandando un PUT sin
    // revision — el bug real que encontró el usuario probando la plataforma.
    const admin = await createActor({ role: "admin" });
    const { project } = await createAdditionalFixture(admin.user.id);

    const res = await as(admin).get(`/additionals/${project.id}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.data.current_budget.revision).toBe("number");
  });

  it("rechaza un revision viejo", async () => {
    const admin = await createActor({ role: "admin" });
    const { project } = await createAdditionalFixture(admin.user.id);
    const { material, provider, materialUnit } = await createBudgetFixture({ actorUserId: admin.user.id });

    const res1 = await as(admin).put(`/additionals/${project.id}/materials`).send({
      revision: 0,
      items: [{ material_id: material.id, provider_id: provider.id, description: "Caño", quantity: 1, material_unit_id: materialUnit.id }],
    });
    expect(res1.status).toBe(200);

    // Reintenta con la misma revision vieja.
    const res2 = await as(admin).put(`/additionals/${project.id}/materials`).send({
      revision: 0,
      items: [{ material_id: material.id, provider_id: provider.id, description: "Otro", quantity: 1, material_unit_id: materialUnit.id }],
    });
    expect(res2.status).toBe(409);
    expect(res2.body.error).toBe("budget_stale");
  });

  it("rechaza el guardado si alguien tiene el presupuesto bloqueado desde Presupuestos", async () => {
    const admin = await createActor({ role: "admin" });
    const { project, budget } = await createAdditionalFixture(admin.user.id);
    const { material, provider, materialUnit } = await createBudgetFixture({ actorUserId: admin.user.id });

    await as(admin).put(`/budgets/${budget.id}/edit-session`).send({});

    const res = await as(admin).put(`/additionals/${project.id}/materials`).send({
      revision: 0,
      items: [{ material_id: material.id, provider_id: provider.id, description: "Caño", quantity: 1, material_unit_id: materialUnit.id }],
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("budget_locked");
    expect(res.body.locked_by.user_id).toBe(admin.user.id);

    const count = await db.BudgetMaterialItem.count({ where: { budget_id: budget.id } });
    expect(count).toBe(0); // no se guardó nada.
  });
});
