"use strict";
// Etapa 1 del plan de edición concurrente de Presupuestos (ver FLOWS.md §35): saveMaterialItems
// y saveLaborLines pasaron de destroy+recreate a upsert por id. Estos tests prueban que el id
// de una línea queda estable entre guardados, que eso no rompe ninguna regla de costo/permiso
// existente, y reproducen el bug real de pisado del catálogo que el upsert cierra.
//
// Todo PUT /budgets/:id requiere `revision` (Etapa 2): un presupuesto recién creado por la
// factory arranca en 0, y cada guardado exitoso la incrementa en 1 — por eso cada PUT de estos
// tests encadena `revision` desde la respuesta del PUT anterior.
const db = require("../../models");
const { createActor, as } = require("../helpers/auth");
const { createBudgetFixture, createBudgetItemType, createMaterial, createMaterialUnit } = require("../factories/budget");
const { saveMaterialItems } = require("../../services/budgetMaterialService");

describe("PUT /budgets/:id — líneas de materiales y mano de obra (Etapa 1: identidad estable)", () => {
  it("los id de las líneas no cambian entre dos guardados consecutivos", async () => {
    const admin = await createActor({ role: "admin" });
    const { budget, material, provider, materialUnit } = await createBudgetFixture({ actorUserId: admin.user.id });

    const res1 = await as(admin).put(`/budgets/${budget.id}`).send({
      revision: 0,
      materialItems: [
        { material_id: material.id, provider_id: provider.id, description: "Caño", quantity: 1, material_unit_id: materialUnit.id, margin_percent: 0 },
      ],
    });
    expect(res1.status).toBe(200);
    const lineId = res1.body.data.materialItems[0].id;

    const res2 = await as(admin).put(`/budgets/${budget.id}`).send({
      revision: res1.body.data.revision,
      materialItems: [
        { id: lineId, material_id: material.id, provider_id: provider.id, description: "Caño", quantity: 2, material_unit_id: materialUnit.id, margin_percent: 0 },
      ],
    });
    expect(res2.status).toBe(200);
    expect(res2.body.data.materialItems).toHaveLength(1);
    expect(res2.body.data.materialItems[0].id).toBe(lineId);
    expect(Number(res2.body.data.materialItems[0].quantity)).toBe(2);
  });

  it("una línea quitada del payload se borra de verdad, sin dejar filas soft-deleted", async () => {
    const admin = await createActor({ role: "admin" });
    const { budget, material, provider, materialUnit } = await createBudgetFixture({ actorUserId: admin.user.id });

    const res1 = await as(admin).put(`/budgets/${budget.id}`).send({
      revision: 0,
      materialItems: [
        { material_id: material.id, provider_id: provider.id, description: "Caño A", quantity: 1, material_unit_id: materialUnit.id, margin_percent: 0 },
        { material_id: material.id, provider_id: provider.id, description: "Caño B", quantity: 1, material_unit_id: materialUnit.id, margin_percent: 0 },
      ],
    });
    expect(res1.body.data.materialItems).toHaveLength(2);
    const [lineA] = res1.body.data.materialItems;

    const res2 = await as(admin).put(`/budgets/${budget.id}`).send({
      revision: res1.body.data.revision,
      materialItems: [
        { id: lineA.id, material_id: material.id, provider_id: provider.id, description: "Caño A", quantity: 1, material_unit_id: materialUnit.id, margin_percent: 0 },
      ],
    });
    expect(res2.body.data.materialItems).toHaveLength(1);

    const countAll = await db.BudgetMaterialItem.count({ where: { budget_id: budget.id }, paranoid: false });
    expect(countAll).toBe(1);
  });

  it("agrega una línea nueva y actualiza la existente en el mismo guardado", async () => {
    const admin = await createActor({ role: "admin" });
    const { budget, material, provider, materialUnit } = await createBudgetFixture({ actorUserId: admin.user.id });

    const res1 = await as(admin).put(`/budgets/${budget.id}`).send({
      revision: 0,
      materialItems: [
        { material_id: material.id, provider_id: provider.id, description: "Caño A", quantity: 1, material_unit_id: materialUnit.id, margin_percent: 0 },
      ],
    });
    const lineA = res1.body.data.materialItems[0];

    const res2 = await as(admin).put(`/budgets/${budget.id}`).send({
      revision: res1.body.data.revision,
      materialItems: [
        { id: lineA.id, material_id: material.id, provider_id: provider.id, description: "Caño A", quantity: 5, material_unit_id: materialUnit.id, margin_percent: 0 },
        { material_id: material.id, provider_id: provider.id, description: "Caño B", quantity: 1, material_unit_id: materialUnit.id, margin_percent: 0 },
      ],
    });
    expect(res2.body.data.materialItems).toHaveLength(2);
    const updated = res2.body.data.materialItems.find((i) => i.id === lineA.id);
    expect(Number(updated.quantity)).toBe(5);
    const created = res2.body.data.materialItems.find((i) => i.id !== lineA.id);
    expect(created.description).toBe("Caño B");
  });

  it("borrar una línea del medio y agregar otra deja el orden correcto al releer", async () => {
    const admin = await createActor({ role: "admin" });
    const { budget, material, provider, materialUnit } = await createBudgetFixture({ actorUserId: admin.user.id });

    const res1 = await as(admin).put(`/budgets/${budget.id}`).send({
      revision: 0,
      materialItems: [
        { material_id: material.id, provider_id: provider.id, description: "Uno", quantity: 1, material_unit_id: materialUnit.id, margin_percent: 0 },
        { material_id: material.id, provider_id: provider.id, description: "Dos", quantity: 1, material_unit_id: materialUnit.id, margin_percent: 0 },
        { material_id: material.id, provider_id: provider.id, description: "Tres", quantity: 1, material_unit_id: materialUnit.id, margin_percent: 0 },
      ],
    });
    const [uno, dos, tres] = res1.body.data.materialItems;

    // Se borra "Dos" (el del medio) y se agrega "Cuatro".
    await as(admin).put(`/budgets/${budget.id}`).send({
      revision: res1.body.data.revision,
      materialItems: [
        { id: uno.id, material_id: material.id, provider_id: provider.id, description: "Uno", quantity: 1, material_unit_id: materialUnit.id, margin_percent: 0 },
        { id: tres.id, material_id: material.id, provider_id: provider.id, description: "Tres", quantity: 1, material_unit_id: materialUnit.id, margin_percent: 0 },
        { material_id: material.id, provider_id: provider.id, description: "Cuatro", quantity: 1, material_unit_id: materialUnit.id, margin_percent: 0 },
      ],
    });

    const res3 = await as(admin).get(`/budgets/${budget.id}`);
    const descriptions = res3.body.data.materialItems.map((i) => i.description);
    // Orden por id ascendente: Uno y Tres conservan su posición relativa (ids viejos, estables)
    // y Cuatro, por ser la línea más nueva, queda al final — nunca entre Uno y Tres.
    expect(descriptions).toEqual(["Uno", "Tres", "Cuatro"]);
  });

  it("re-guardar sin tocar nada no escribe en el catálogo de materiales", async () => {
    const admin = await createActor({ role: "admin" });
    const { budget, material, provider, materialUnit } = await createBudgetFixture({ actorUserId: admin.user.id, materialCost: 100 });

    const res1 = await as(admin).put(`/budgets/${budget.id}`).send({
      revision: 0,
      materialItems: [
        { material_id: material.id, provider_id: provider.id, description: "Caño", quantity: 1, material_unit_id: materialUnit.id, margin_percent: 0 },
      ],
    });
    const line = res1.body.data.materialItems[0];
    expect(Number(line.material_cost_snapshot)).toBe(100);

    const historyBefore = await db.MaterialCostHistory.count({ where: { material_id: material.id, provider_id: provider.id } });

    await as(admin).put(`/budgets/${budget.id}`).send({
      revision: res1.body.data.revision,
      materialItems: [
        { id: line.id, material_id: material.id, provider_id: provider.id, description: "Caño", quantity: 1, material_unit_id: materialUnit.id, margin_percent: 0, material_cost_snapshot: 100, material_cost_currency: "ARS" },
      ],
    });

    const price = await db.MaterialProviderPrice.findOne({ where: { material_id: material.id, provider_id: provider.id } });
    expect(parseFloat(price.cost)).toBe(100);
    const historyAfter = await db.MaterialCostHistory.count({ where: { material_id: material.id, provider_id: provider.id } });
    expect(historyAfter).toBe(historyBefore);
  });

  it("el bug, como regresión: una línea sin tocar no revierte un cambio de catálogo hecho por otra parte", async () => {
    const admin = await createActor({ role: "admin" });
    const { budget, material, provider, materialUnit } = await createBudgetFixture({ actorUserId: admin.user.id, materialCost: 100 });

    // PUT #1: se crea la línea L1.
    const res1 = await as(admin).put(`/budgets/${budget.id}`).send({
      revision: 0,
      materialItems: [
        { material_id: material.id, provider_id: provider.id, description: "Caño", quantity: 1, material_unit_id: materialUnit.id, margin_percent: 0 },
      ],
    });
    const l1 = res1.body.data.materialItems[0];
    expect(Number(l1.material_cost_snapshot)).toBe(100);

    // PUT #2: "otra parte" re-envía L1 por su id correcto (y su revision correcta) y agrega una
    // línea nueva L2. Con el destroy+recreate viejo, esto le cambiaba el id a L1 sin que nadie
    // la haya tocado.
    const res2 = await as(admin).put(`/budgets/${budget.id}`).send({
      revision: res1.body.data.revision,
      materialItems: [
        { id: l1.id, material_id: material.id, provider_id: provider.id, description: "Caño", quantity: 1, material_unit_id: materialUnit.id, margin_percent: 0, material_cost_snapshot: 100, material_cost_currency: "ARS" },
        { material_id: material.id, provider_id: provider.id, description: "Caño 2", quantity: 1, material_unit_id: materialUnit.id, margin_percent: 0 },
      ],
    });
    const l1After = res2.body.data.materialItems.find((i) => i.description === "Caño");
    expect(l1After.id).toBe(l1.id); // la prueba clave: el id de L1 no cambió por el save de otra línea.

    // Alguien cambia el catálogo por fuera (p. ej. desde Pañol) mientras el form de A sigue viejo.
    await db.MaterialProviderPrice.update({ cost: 500 }, { where: { material_id: material.id, provider_id: provider.id } });

    // PUT #3: A, con su form viejo (nunca refrescó, no sabe de L2 ni de la revision nueva —
    // pero SÍ conoce el id de L1, que no cambió), re-envía SOLO L1 con el snapshot que tenía
    // cargado (100, el de antes del cambio de catálogo). Manda la revision correcta porque esa
    // sí viajó con la respuesta original del alta de L1 — lo que el form de A NO vio es el save
    // de "otra parte" (res2), exactamente el escenario que el control de concurrencia de la
    // Etapa 2 (no esta) ataca aparte; acá solo importa que el id de L1 siga siendo el mismo.
    await as(admin).put(`/budgets/${budget.id}`).send({
      revision: res2.body.data.revision,
      materialItems: [
        { id: l1.id, material_id: material.id, provider_id: provider.id, description: "Caño", quantity: 1, material_unit_id: materialUnit.id, margin_percent: 0, material_cost_snapshot: 100, material_cost_currency: "ARS" },
      ],
    });

    const price = await db.MaterialProviderPrice.findOne({ where: { material_id: material.id, provider_id: provider.id } });
    expect(parseFloat(price.cost)).toBe(500);
  });

  it("editar el costo real con material_costs_read sincroniza el catálogo y crea historial", async () => {
    const admin = await createActor({ role: "admin" });
    const { budget, material, provider, materialUnit } = await createBudgetFixture({ actorUserId: admin.user.id, materialCost: 100 });

    const res1 = await as(admin).put(`/budgets/${budget.id}`).send({
      revision: 0,
      materialItems: [
        { material_id: material.id, provider_id: provider.id, description: "Caño", quantity: 1, material_unit_id: materialUnit.id, margin_percent: 0 },
      ],
    });
    const line = res1.body.data.materialItems[0];

    await as(admin).put(`/budgets/${budget.id}`).send({
      revision: res1.body.data.revision,
      materialItems: [
        { id: line.id, material_id: material.id, provider_id: provider.id, description: "Caño", quantity: 1, material_unit_id: materialUnit.id, margin_percent: 0, material_cost_snapshot: 250, material_cost_currency: "ARS" },
      ],
    });

    const price = await db.MaterialProviderPrice.findOne({ where: { material_id: material.id, provider_id: provider.id } });
    expect(parseFloat(price.cost)).toBe(250);
    const history = await db.MaterialCostHistory.findAll({ where: { material_id: material.id, provider_id: provider.id } });
    expect(history).toHaveLength(1);
    expect(parseFloat(history[0].cost)).toBe(250);
  });

  it("sin budget_prices_read, re-guardar conserva los valores de mano de obra cargados antes", async () => {
    const admin = await createActor({ role: "admin" });
    const limited = await createActor({ permissions: ["budgets_read", "budgets_update"] });
    const itemType = await createBudgetItemType();
    const { budget } = await createBudgetFixture({ actorUserId: admin.user.id });

    const res1 = await as(admin).put(`/budgets/${budget.id}`).send({
      revision: 0,
      laborLines: [
        { budget_item_type_id: itemType.id, quantity: 10, unit_price: 500, currency: "ARS" },
      ],
    });
    const line = res1.body.data.laborLines[0];
    expect(Number(line.unit_price)).toBe(500);

    // El actor sin budget_prices_read manda un precio distinto, pero no se le toma en cuenta.
    const res2 = await as(limited).put(`/budgets/${budget.id}`).send({
      revision: res1.body.data.revision,
      laborLines: [
        { id: line.id, budget_item_type_id: itemType.id, quantity: 20, unit_price: 999, currency: "USD" },
      ],
    });
    expect(res2.status).toBe(200);

    const row = await db.BudgetLaborLine.findByPk(line.id);
    expect(parseFloat(row.unit_price)).toBe(500);
    expect(row.currency).toBe("ARS");
    expect(parseFloat(row.quantity)).toBe(20); // la cantidad sí la puede cargar.
  });

  it("conserva hours_per_day de un rubro por días entre guardados", async () => {
    const admin = await createActor({ role: "admin" });
    const daysType = await createBudgetItemType({ unit_type: "days", unit_label: "días" });
    const { budget } = await createBudgetFixture({ actorUserId: admin.user.id });

    const res1 = await as(admin).put(`/budgets/${budget.id}`).send({
      revision: 0,
      laborLines: [{ budget_item_type_id: daysType.id, quantity: 2, unit_price: 100, currency: "ARS" }],
    });
    const line = res1.body.data.laborLines[0];
    expect(parseFloat(line.hours_per_day)).toBe(9);

    const res2 = await as(admin).put(`/budgets/${budget.id}`).send({
      revision: res1.body.data.revision,
      laborLines: [{ id: line.id, budget_item_type_id: daysType.id, quantity: 3, unit_price: 100, currency: "ARS" }],
    });
    expect(parseFloat(res2.body.data.laborLines[0].hours_per_day)).toBe(9);
  });

  it("rubros de mano de obra repetidos no dan UniqueConstraintError y conservan sus ids", async () => {
    const admin = await createActor({ role: "admin" });
    const itemType = await createBudgetItemType();
    const { budget } = await createBudgetFixture({ actorUserId: admin.user.id });

    const res1 = await as(admin).put(`/budgets/${budget.id}`).send({
      revision: 0,
      laborLines: [
        { budget_item_type_id: itemType.id, quantity: 10, unit_price: 100, currency: "ARS" },
        { budget_item_type_id: itemType.id, quantity: 20, unit_price: 200, currency: "ARS" },
      ],
    });
    expect(res1.status).toBe(200);
    expect(res1.body.data.laborLines).toHaveLength(2);
    const [first, second] = res1.body.data.laborLines;

    const res2 = await as(admin).put(`/budgets/${budget.id}`).send({
      revision: res1.body.data.revision,
      laborLines: [
        { id: first.id, budget_item_type_id: itemType.id, quantity: 11, unit_price: 100, currency: "ARS" },
        { id: second.id, budget_item_type_id: itemType.id, quantity: 21, unit_price: 200, currency: "ARS" },
      ],
    });
    expect(res2.status).toBe(200);
    expect(res2.body.data.laborLines.map((l) => l.id).sort()).toEqual([first.id, second.id].sort());
  });

  it("preserveMargins: los márgenes existentes se conservan y los nuevos nacen en 0 (camino de Adicionales)", async () => {
    const admin = await createActor({ role: "admin" });
    const { budget, material, provider, materialUnit } = await createBudgetFixture({ actorUserId: admin.user.id, materialCost: 100 });

    // Carga normal desde Presupuestos, con margen.
    await as(admin).put(`/budgets/${budget.id}`).send({
      revision: 0,
      materialItems: [
        { material_id: material.id, provider_id: provider.id, description: "Caño", quantity: 1, material_unit_id: materialUnit.id, margin_percent: 30 },
      ],
    });
    const existingRow = await db.BudgetMaterialItem.findOne({ where: { budget_id: budget.id } });
    expect(parseFloat(existingRow.margin_percent)).toBe(30);

    // Camino de Adicionales: preserveMargins=true, igual que additionalController#updateMaterials.
    // Llamada directa al service (no al endpoint): el revision/lock de la Etapa 2 vive en el
    // controller, no acá — esto solo prueba la regla de negocio de preserveMargins.
    await db.sequelize.transaction(async (transaction) => {
      await saveMaterialItems(
        budget,
        [
          { id: existingRow.id, material_id: material.id, provider_id: provider.id, description: "Caño", quantity: 2, material_unit_id: materialUnit.id, margin_percent: 999 },
          { material_id: material.id, provider_id: provider.id, description: "Caño nuevo", quantity: 1, material_unit_id: materialUnit.id, margin_percent: 999 },
        ],
        admin.user,
        transaction,
        { preserveMargins: true }
      );
    });

    const rows = await db.BudgetMaterialItem.findAll({ where: { budget_id: budget.id }, order: [["id", "ASC"]] });
    expect(parseFloat(rows[0].margin_percent)).toBe(30); // conservado, pese a que llegó 999
    expect(parseFloat(rows[1].margin_percent)).toBe(0); // nueva línea, nace en 0
  });

  it("rollback: un error al guardar materiales deja intactas las líneas de mano de obra", async () => {
    const admin = await createActor({ role: "admin" });
    const itemType = await createBudgetItemType();
    const { budget } = await createBudgetFixture({ actorUserId: admin.user.id });

    const res1 = await as(admin).put(`/budgets/${budget.id}`).send({
      revision: 0,
      laborLines: [{ budget_item_type_id: itemType.id, quantity: 1, unit_price: 100, currency: "ARS" }],
    });
    const laborLine = res1.body.data.laborLines[0];

    const materialUnit = await createMaterialUnit();
    const materialSinCosto = await createMaterial({ materialUnitId: materialUnit.id });

    const res2 = await as(admin).put(`/budgets/${budget.id}`).send({
      revision: res1.body.data.revision,
      laborLines: [{ id: laborLine.id, budget_item_type_id: itemType.id, quantity: 99, unit_price: 500, currency: "ARS" }],
      materialItems: [
        { material_id: materialSinCosto.id, description: "Sin costo", quantity: 1, material_unit_id: materialUnit.id, margin_percent: 0 },
      ],
    });
    expect(res2.status).toBe(400);

    const row = await db.BudgetLaborLine.findByPk(laborLine.id);
    expect(parseFloat(row.quantity)).toBe(1);
    expect(parseFloat(row.unit_price)).toBe(100);
  });
});
