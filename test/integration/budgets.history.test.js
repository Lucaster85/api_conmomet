"use strict";
// Etapa 3 del plan de edición concurrente de Presupuestos (ver FLOWS.md §35): GET
// /budgets/:id/history lee de AuditLogs (sin tabla nueva) y pela costos/valores de mano de
// obra según permiso, con las mismas reglas que applyPriceVisibility.
const { createActor, as } = require("../helpers/auth");
const { createBudgetFixture, createBudgetItemType } = require("../factories/budget");

describe("GET /budgets/:id/history (Etapa 3: historial)", () => {
  it("un guardado que agrega 2 materiales deja una entrada con autor y la descripción de los materiales", async () => {
    const admin = await createActor({ role: "admin" });
    const { budget, material, provider, materialUnit } = await createBudgetFixture({ actorUserId: admin.user.id });

    await as(admin).put(`/budgets/${budget.id}`).send({
      revision: 0,
      materialItems: [
        { material_id: material.id, provider_id: provider.id, description: "Caño A", quantity: 1, material_unit_id: materialUnit.id, margin_percent: 0 },
        { material_id: material.id, provider_id: provider.id, description: "Caño B", quantity: 1, material_unit_id: materialUnit.id, margin_percent: 0 },
      ],
    });

    const res = await as(admin).get(`/budgets/${budget.id}/history`);
    expect(res.status).toBe(200);
    const entry = res.body.data.find((e) => e.field_changed === "material_items");
    expect(entry).toBeTruthy();
    expect(entry.actor.id).toBe(admin.user.id);
    expect(entry.context.added.map((l) => l.description).sort()).toEqual(["Caño A", "Caño B"]);
  });

  it("un guardado que borra 1 material deja la baja con el nombre del material borrado", async () => {
    const admin = await createActor({ role: "admin" });
    const { budget, material, provider, materialUnit } = await createBudgetFixture({ actorUserId: admin.user.id });

    const res1 = await as(admin).put(`/budgets/${budget.id}`).send({
      revision: 0,
      materialItems: [
        { material_id: material.id, provider_id: provider.id, description: "Caño A", quantity: 1, material_unit_id: materialUnit.id, margin_percent: 0 },
      ],
    });
    const lineA = res1.body.data.materialItems[0];

    await as(admin).put(`/budgets/${budget.id}`).send({ revision: res1.body.data.revision, materialItems: [] });

    const res = await as(admin).get(`/budgets/${budget.id}/history`);
    const deleteEntry = res.body.data.find((e) => e.field_changed === "material_items" && e.context.removed.length > 0);
    expect(deleteEntry).toBeTruthy();
    expect(deleteEntry.context.removed[0].description).toBe("Caño A");
    void lineA;
  });

  it("un cambio de campo de cabecera queda con su before/after", async () => {
    const admin = await createActor({ role: "admin" });
    const { budget } = await createBudgetFixture({ actorUserId: admin.user.id });

    await as(admin).put(`/budgets/${budget.id}`).send({ revision: 0, title: "Título nuevo" });

    const res = await as(admin).get(`/budgets/${budget.id}/history`);
    const entry = res.body.data.find((e) => e.field_changed === "fields");
    expect(entry).toBeTruthy();
    const titleChange = entry.context.changes.find((c) => c.field === "title");
    expect(titleChange.after).toBe("Título nuevo");
  });

  it("el cambio de estado queda registrado, incluido quién rechazó y el motivo", async () => {
    const admin = await createActor({ role: "admin" });
    const itemType = await createBudgetItemType();
    const { budget } = await createBudgetFixture({ actorUserId: admin.user.id });

    await as(admin).put(`/budgets/${budget.id}`).send({
      revision: 0,
      laborLines: [{ budget_item_type_id: itemType.id, quantity: 1, unit_price: 100, currency: "ARS" }],
    });
    await as(admin).put(`/budgets/${budget.id}/status`).field("status", "sent");
    const rejector = await createActor({ role: "admin" });
    await as(rejector).put(`/budgets/${budget.id}/status`).field("status", "rejected").field("rejection_reason", "Precio muy alto");

    const res = await as(admin).get(`/budgets/${budget.id}/history`);
    const rejectedEntry = res.body.data.find((e) => e.field_changed === "status" && e.new_value === "rejected");
    expect(rejectedEntry).toBeTruthy();
    expect(rejectedEntry.actor.id).toBe(rejector.user.id);
    expect(rejectedEntry.notes).toBe("Precio muy alto");
    expect(rejectedEntry.previous_value).toBe("sent");
  });

  it("las entradas vienen ordenadas desc", async () => {
    const admin = await createActor({ role: "admin" });
    const { budget } = await createBudgetFixture({ actorUserId: admin.user.id });

    const res1 = await as(admin).put(`/budgets/${budget.id}`).send({ revision: 0, title: "Uno" });
    await as(admin).put(`/budgets/${budget.id}`).send({ revision: res1.body.data.revision, title: "Dos" });

    const res = await as(admin).get(`/budgets/${budget.id}/history`);
    const ats = res.body.data.map((e) => new Date(e.at).getTime());
    const sorted = [...ats].sort((a, b) => b - a);
    expect(ats).toEqual(sorted);
  });

  it("el JSON crudo no filtra costos a un actor sin material_costs_read ni valores de mano de obra sin budget_prices_read", async () => {
    const admin = await createActor({ role: "admin" });
    const limited = await createActor({ permissions: ["budgets_read"] });
    const itemType = await createBudgetItemType();
    const { budget, material, provider, materialUnit } = await createBudgetFixture({ actorUserId: admin.user.id, materialCost: 100 });

    await as(admin).put(`/budgets/${budget.id}`).send({
      revision: 0,
      laborLines: [{ budget_item_type_id: itemType.id, quantity: 1, unit_price: 500, currency: "ARS" }],
      materialItems: [
        { material_id: material.id, provider_id: provider.id, description: "Caño", quantity: 1, material_unit_id: materialUnit.id, margin_percent: 0 },
      ],
    });

    const res = await as(limited).get(`/budgets/${budget.id}/history`);
    expect(res.status).toBe(200);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain("material_cost_snapshot");
    expect(raw).not.toContain("500"); // unit_price de mano de obra
    expect(raw).not.toContain("estimated_total");

    const materialEntry = res.body.data.find((e) => e.field_changed === "material_items");
    // El precio de materiales NO está gateado — tiene que seguir viéndose.
    expect(materialEntry.context.added[0]).toHaveProperty("unit_price");
  });

  it("401 sin budgets_read; todo visible con admin_granted", async () => {
    const admin = await createActor({ role: "admin" });
    const noAccess = await createActor({ permissions: [] });
    const { budget } = await createBudgetFixture({ actorUserId: admin.user.id });

    await as(admin).put(`/budgets/${budget.id}`).send({ revision: 0, title: "Con contenido" });

    const resDenied = await as(noAccess).get(`/budgets/${budget.id}/history`);
    expect(resDenied.status).toBe(401);

    const resAllowed = await as(admin).get(`/budgets/${budget.id}/history`);
    expect(resAllowed.status).toBe(200);
    expect(resAllowed.body.data.length).toBeGreaterThan(0);
  });
});
