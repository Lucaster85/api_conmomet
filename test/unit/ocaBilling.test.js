"use strict";
// Importe y requisitos para facturar una OCA (services/ocaBillingService.js, FLOWS.md §74). Misma regla que el presupuesto de la pantalla de OCAs.
const { computeOcaNet, billingProblems, summarizeHours } = require("../../services/ocaBillingService");

const line = (over = {}) => ({ regular_hours: 8, overtime_50_hours: 0, overtime_100_hours: 0, vehicle_id: null, hourly_rate: null, ...over });
const manHours = (over = {}) => ({ type: "man_hours", status: "aprobado", requires_budget: false, budget_status: null, hourly_rate: "10000.00", lines: [line()], ...over });

describe("computeOcaNet", () => {
  it("horas hombre: simples + 1,5 x al 50% + 2 x al 100%, por el valor hora de la OCA", () => {
    const oca = manHours({ lines: [line({ regular_hours: "8.00", overtime_50_hours: "2.00" }), line({ regular_hours: 8, overtime_100_hours: 1 })] });
    // simples 16, 50% 2, 100% 1  =>  16*10000 + 2*15000 + 1*20000
    expect(computeOcaNet(oca)).toEqual({ net: 210000, priced: true });
  });

  it("horas hombre sin valor hora no tiene precio", () => {
    expect(computeOcaNet(manHours({ hourly_rate: null }))).toEqual({ net: 0, priced: false });
    expect(computeOcaNet(manHours({ hourly_rate: "0.00" })).priced).toBe(false);
  });

  it("grúa: horas totales de cada vehículo por el valor hora de ese vehículo", () => {
    const oca = {
      type: "crane_hours", hourly_rate: null,
      lines: [
        line({ vehicle_id: 1, regular_hours: 6, overtime_50_hours: 2, hourly_rate: "50000.00" }),
        line({ vehicle_id: 2, regular_hours: 4, hourly_rate: "80000.00" }),
        line({ vehicle_id: null, regular_hours: 99 }), // sin vehículo: no cuenta
      ],
    };
    expect(computeOcaNet(oca)).toEqual({ net: 8 * 50000 + 4 * 80000, priced: true });
  });

  it("grúa: si algún vehículo no tiene valor hora, o no hay vehículos, no tiene precio", () => {
    expect(computeOcaNet({ type: "crane_hours", lines: [line({ vehicle_id: 1, hourly_rate: "50000" }), line({ vehicle_id: 2 })] }).priced).toBe(false);
    expect(computeOcaNet({ type: "crane_hours", lines: [line()] }).priced).toBe(false);
  });

  it("redondea a centavos", () => {
    expect(computeOcaNet(manHours({ hourly_rate: "3333.33", lines: [line({ regular_hours: 1.5 })] })).net).toBe(5000);
  });
});

describe("summarizeHours", () => {
  it("suma las horas por tipo y el total", () => {
    expect(summarizeHours(manHours({ lines: [line({ overtime_50_hours: 1.5 }), line({ overtime_100_hours: 2 })] }))).toEqual({ regular: 16, ot50: 1.5, ot100: 2, total: 19.5 });
  });
});

describe("billingProblems", () => {
  it("una OCA aprobada y con precio se puede facturar", () => {
    expect(billingProblems(manHours())).toEqual([]);
  });

  it("tiene que estar aprobada", () => {
    for (const status of ["pendiente", "presentado", "rechazado", "anulado"]) {
      expect(billingProblems(manHours({ status })).join()).toMatch(/no está aprobada/);
    }
  });

  it("si pidió presupuesto, el presupuesto también tiene que estar aprobado", () => {
    expect(billingProblems(manHours({ requires_budget: true, budget_status: "presentado" })).join()).toMatch(/presupuesto/);
    expect(billingProblems(manHours({ requires_budget: true, budget_status: "aprobado" }))).toEqual([]);
  });

  it("necesita valor hora y horas", () => {
    expect(billingProblems(manHours({ hourly_rate: null })).join()).toMatch(/valor hora/);
    expect(billingProblems(manHours({ lines: [] })).join()).toMatch(/no tiene horas/);
  });
});
