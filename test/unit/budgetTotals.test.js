"use strict";
const { computeTotalsByCurrency } = require("../../helpers/budgetTotals");

describe("computeTotalsByCurrency", () => {
  it("con listas vacías devuelve {ARS: 0, USD: 0}", () => {
    const budget = { currency: "ARS", labor_discount_percent: 0, material_discount_percent: 0 };
    expect(computeTotalsByCurrency(budget, [], [])).toEqual({ ARS: 0, USD: 0 });
  });

  it("usa la moneda del budget cuando la línea no tiene la suya", () => {
    const budget = { currency: "USD", labor_discount_percent: 0, material_discount_percent: 0 };
    const laborLines = [{ currency: null, estimated_total: 100 }];
    const totals = computeTotalsByCurrency(budget, laborLines, []);
    expect(totals.USD).toBe(100);
    expect(totals.ARS).toBe(0);
  });

  it("suma estimated_total en la moneda propia de la línea, no la del budget", () => {
    const budget = { currency: "ARS", labor_discount_percent: 0, material_discount_percent: 0 };
    const laborLines = [
      { currency: "ARS", estimated_total: 100 },
      { currency: "USD", estimated_total: 50 },
    ];
    const totals = computeTotalsByCurrency(budget, laborLines, []);
    expect(totals.ARS).toBe(100);
    expect(totals.USD).toBe(50);
  });

  it("nunca netea ARS contra USD: cada moneda queda separada", () => {
    const budget = { currency: "ARS", labor_discount_percent: 0, material_discount_percent: 0 };
    const laborLines = [{ currency: "ARS", estimated_total: 100 }];
    const materialItems = [{ currency: "USD", total_price: 30 }];
    const totals = computeTotalsByCurrency(budget, laborLines, materialItems);
    expect(totals).toEqual({ ARS: 100, USD: 30 });
  });

  it("labor_discount_percent aplica solo al total de mano de obra", () => {
    const budget = { currency: "ARS", labor_discount_percent: 10, material_discount_percent: 0 };
    const laborLines = [{ currency: "ARS", estimated_total: 100 }];
    const materialItems = [{ currency: "ARS", total_price: 100 }];
    const totals = computeTotalsByCurrency(budget, laborLines, materialItems);
    // labor: 100 * 0.9 = 90; materials: 100 sin descuento → 190
    expect(totals.ARS).toBe(190);
  });

  it("material_discount_percent aplica solo al total de materiales", () => {
    const budget = { currency: "ARS", labor_discount_percent: 0, material_discount_percent: 20 };
    const laborLines = [{ currency: "ARS", estimated_total: 100 }];
    const materialItems = [{ currency: "ARS", total_price: 100 }];
    const totals = computeTotalsByCurrency(budget, laborLines, materialItems);
    // labor: 100 sin descuento; materials: 100 * 0.8 = 80 → 180
    expect(totals.ARS).toBe(180);
  });

  it("con descuento en 0 devuelve el bruto exacto", () => {
    const budget = { currency: "ARS", labor_discount_percent: 0, material_discount_percent: 0 };
    const laborLines = [{ currency: "ARS", estimated_total: 123.45 }];
    const totals = computeTotalsByCurrency(budget, laborLines, []);
    expect(totals.ARS).toBe(123.45);
  });

  it("con descuento en 100% devuelve 0 y no un negativo", () => {
    const budget = { currency: "ARS", labor_discount_percent: 100, material_discount_percent: 100 };
    const laborLines = [{ currency: "ARS", estimated_total: 100 }];
    const materialItems = [{ currency: "ARS", total_price: 100 }];
    const totals = computeTotalsByCurrency(budget, laborLines, materialItems);
    expect(totals.ARS).toBe(0);
  });

  it("no rompe con líneas de estimated_total o total_price null/undefined", () => {
    const budget = { currency: "ARS", labor_discount_percent: 0, material_discount_percent: 0 };
    const laborLines = [{ currency: "ARS", estimated_total: null }, { currency: "ARS" }];
    const materialItems = [{ currency: "ARS", total_price: undefined }];
    expect(() => computeTotalsByCurrency(budget, laborLines, materialItems)).not.toThrow();
    expect(computeTotalsByCurrency(budget, laborLines, materialItems).ARS).toBe(0);
  });
});
