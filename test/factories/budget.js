"use strict";
// Fixtures de Presupuestos. Cada create* mintea una fila NUEVA (no reusa datos de otro test):
// Providers/BudgetItemTypes/MaterialUnits no se truncan entre tests (ver test/setup/truncate.js
// — son catálogos de referencia sembrados por migración, no fixtures), así que esto evita que
// un test dependa por accidente de filas que dejó otro.
const crypto = require("crypto");
const db = require("../../models");

let counter = 0;
function nextId() {
  counter += 1;
  return counter;
}

async function createClient(overrides = {}) {
  const n = nextId();
  return db.Client.create({
    razonSocial: `Cliente Test ${n}`,
    email: `cliente${n}@test.local`,
    ...overrides,
  });
}

async function createBudgetItemType(overrides = {}) {
  const n = nextId();
  return db.BudgetItemType.create({
    name: `Rubro Test ${n}`,
    unit_type: "hours",
    unit_label: "hs",
    ...overrides,
  });
}

async function createMaterialUnit(overrides = {}) {
  // label es unique, STRING(20), y la tabla no se trunca entre tests (ver test/setup/
  // truncate.js) ni entre corridas sueltas de `npm run test:integration` sin un
  // `db:test:reset` en el medio — un contador que arranca de 0 en cada proceso puede repetir
  // el mismo label de una corrida a otra. 8 hex de randomUUID() entran en el límite de columna
  // y alcanzan de sobra para no colisionar.
  return db.MaterialUnit.create({
    label: `u${crypto.randomUUID().slice(0, 8)}`,
    ...overrides,
  });
}

async function createProvider(overrides = {}) {
  const n = nextId();
  return db.Provider.create({
    razonSocial: `Proveedor Test ${n}`,
    ...overrides,
  });
}

async function createMaterial({ materialUnitId, ...overrides } = {}) {
  const n = nextId();
  const unitId = materialUnitId || (await createMaterialUnit()).id;
  return db.Material.create({
    description: `Material Test ${n}`,
    material_unit_id: unitId,
    ...overrides,
  });
}

async function createMaterialProviderPrice({ materialId, providerId, cost = 100, currency = "ARS" }) {
  return db.MaterialProviderPrice.create({
    material_id: materialId,
    provider_id: providerId,
    cost,
    currency,
  });
}

async function createBudget({ clientId, createdBy, status = "draft", ...overrides } = {}) {
  const n = nextId();
  return db.Budget.create({
    number: `PRES-TEST-${n}`,
    title: `Presupuesto Test ${n}`,
    client_id: clientId,
    created_by: createdBy,
    status,
    ...overrides,
  });
}

/**
 * Fixture base para tests de líneas: Client + BudgetItemType + MaterialUnit + Provider +
 * Material con costo ya cargado en el catálogo (MaterialProviderPrice) + Budget en draft.
 * `actorUserId` es el creador del Budget (created_by, NOT NULL).
 */
async function createBudgetFixture({ actorUserId, materialCost = 100 } = {}) {
  const client = await createClient();
  const itemType = await createBudgetItemType();
  const materialUnit = await createMaterialUnit();
  const provider = await createProvider();
  const material = await createMaterial({ materialUnitId: materialUnit.id });
  await createMaterialProviderPrice({ materialId: material.id, providerId: provider.id, cost: materialCost });
  const budget = await createBudget({ clientId: client.id, createdBy: actorUserId });

  return { client, itemType, materialUnit, provider, material, budget };
}

module.exports = {
  createClient,
  createBudgetItemType,
  createMaterialUnit,
  createProvider,
  createMaterial,
  createMaterialProviderPrice,
  createBudget,
  createBudgetFixture,
};
