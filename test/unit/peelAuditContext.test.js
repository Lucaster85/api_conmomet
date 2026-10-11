"use strict";
const { peelAuditContext } = require("../../helpers/budgetTotals");

const admin = { permissions: [{ name: "admin_granted" }] };
const nobody = { permissions: [] };
const withCosts = { permissions: [{ name: "material_costs_read" }] };
const withPrices = { permissions: [{ name: "budget_prices_read" }] };

describe("peelAuditContext", () => {
  it("pela material_cost_snapshot y material_cost_currency sin material_costs_read", () => {
    const entry = {
      field_changed: "material_items",
      context: {
        added: [{ description: "Caño", unit_price: 120, material_cost_snapshot: 100, material_cost_currency: "ARS" }],
        removed: [],
        changed: [],
      },
    };
    const peeled = peelAuditContext(entry, nobody);
    expect(peeled.context.added[0]).not.toHaveProperty("material_cost_snapshot");
    expect(peeled.context.added[0]).not.toHaveProperty("material_cost_currency");
    // No gateado: el precio/margen de materiales se ve igual sin material_costs_read.
    expect(peeled.context.added[0].unit_price).toBe(120);
  });

  it("pela unit_price/currency/estimated_total en entradas de mano de obra sin budget_prices_read", () => {
    const entry = {
      field_changed: "labor_lines",
      context: {
        added: [{ item_type: "Hs Montaje", quantity: 10, unit_price: 500, currency: "ARS", estimated_total: 5000 }],
        removed: [],
        changed: [],
      },
    };
    const peeled = peelAuditContext(entry, nobody);
    expect(peeled.context.added[0]).not.toHaveProperty("unit_price");
    expect(peeled.context.added[0]).not.toHaveProperty("currency");
    expect(peeled.context.added[0]).not.toHaveProperty("estimated_total");
    expect(peeled.context.added[0].quantity).toBe(10);
  });

  it("no pela unit_price ni margin_percent en entradas de material (no están gateados)", () => {
    const entry = {
      field_changed: "material_items",
      context: { added: [{ description: "Caño", unit_price: 120, margin_percent: 20 }], removed: [], changed: [] },
    };
    const peeled = peelAuditContext(entry, nobody);
    expect(peeled.context.added[0].unit_price).toBe(120);
    expect(peeled.context.added[0].margin_percent).toBe(20);
  });

  it("pela changed (before y after) igual que added/removed", () => {
    const entry = {
      field_changed: "labor_lines",
      context: {
        added: [], removed: [],
        changed: [{ before: { unit_price: 100, currency: "ARS" }, after: { unit_price: 200, currency: "ARS" } }],
      },
    };
    const peeled = peelAuditContext(entry, nobody);
    expect(peeled.context.changed[0].before).not.toHaveProperty("unit_price");
    expect(peeled.context.changed[0].after).not.toHaveProperty("unit_price");
  });

  it("redacta totals_by_currency y discount_percent enteros sin budget_prices_read", () => {
    const totalsEntry = { field_changed: "totals_by_currency", context: { totals_before: { ARS: 100 }, totals_after: { ARS: 200 } } };
    expect(peelAuditContext(totalsEntry, nobody).context).toBeNull();

    const discountEntry = { field_changed: "discount_percent", context: { labor_before: 0, labor_after: 10 } };
    expect(peelAuditContext(discountEntry, nobody).context).toBeNull();
  });

  it("con budget_prices_read no redacta totals_by_currency ni las líneas de mano de obra", () => {
    const totalsEntry = { field_changed: "totals_by_currency", context: { totals_before: { ARS: 100 }, totals_after: { ARS: 200 } } };
    expect(peelAuditContext(totalsEntry, withPrices).context).not.toBeNull();

    const laborEntry = { field_changed: "labor_lines", context: { added: [{ unit_price: 100 }], removed: [], changed: [] } };
    expect(peelAuditContext(laborEntry, withPrices).context.added[0]).toHaveProperty("unit_price");
  });

  it("con material_costs_read no pela el costo real de materiales", () => {
    const entry = { field_changed: "material_items", context: { added: [{ material_cost_snapshot: 100 }], removed: [], changed: [] } };
    expect(peelAuditContext(entry, withCosts).context.added[0]).toHaveProperty("material_cost_snapshot");
  });

  it("admin_granted ve todo", () => {
    const totalsEntry = { field_changed: "totals_by_currency", context: { totals_before: {}, totals_after: {} } };
    expect(peelAuditContext(totalsEntry, admin).context).not.toBeNull();

    const laborEntry = { field_changed: "labor_lines", context: { added: [{ unit_price: 100 }], removed: [], changed: [] } };
    expect(peelAuditContext(laborEntry, admin).context.added[0]).toHaveProperty("unit_price");

    const materialEntry = { field_changed: "material_items", context: { added: [{ material_cost_snapshot: 100 }], removed: [], changed: [] } };
    expect(peelAuditContext(materialEntry, admin).context.added[0]).toHaveProperty("material_cost_snapshot");
  });

  it("entradas sin context (p. ej. field_changed: status) pasan sin tocar", () => {
    const entry = { field_changed: "status", previous_value: "sent", new_value: "rejected", context: null };
    expect(peelAuditContext(entry, nobody)).toEqual(entry);
  });

  it("field_changed ajeno a estas reglas (p. ej. fields) no se toca", () => {
    const entry = { field_changed: "fields", context: { revision: 3, changes: [{ field: "title", before: "A", after: "B" }] } };
    expect(peelAuditContext(entry, nobody)).toEqual(entry);
  });
});
