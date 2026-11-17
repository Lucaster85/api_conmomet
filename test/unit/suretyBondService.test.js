"use strict";
// Estado de un seguro de caución según su vencimiento (services/suretyBondService.js, FLOWS.md §69).
const { suretyBondStatus, daysUntilExpiration, daysBetween } = require("../../services/suretyBondService");

const TODAY = "2026-11-20";
const bond = (overrides = {}) => ({ expiration_date: "2027-03-01", notify_days_before: 30, released_at: null, ...overrides });

describe("daysBetween", () => {
  it("cuenta días calendario sin importar la zona horaria", () => {
    expect(daysBetween("2026-11-20", "2026-11-21")).toBe(1);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2026-11-20", "2026-11-19")).toBe(-1);
  });
});

describe("suretyBondStatus", () => {
  it("una póliza liberada no avisa, aunque esté vencida", () => {
    expect(suretyBondStatus(bond({ released_at: "2026-11-01", expiration_date: "2026-01-01" }), TODAY)).toBe("released");
  });

  it("sin vencimiento nunca avisa", () => {
    expect(suretyBondStatus(bond({ expiration_date: null }), TODAY)).toBe("no_expiration");
  });

  it("vence ayer: vencida", () => {
    expect(suretyBondStatus(bond({ expiration_date: "2026-11-19" }), TODAY)).toBe("expired");
  });

  it("vence hoy: por vencer (todavía es válida)", () => {
    expect(suretyBondStatus(bond({ expiration_date: TODAY }), TODAY)).toBe("expiring_soon");
  });

  it("vence justo en el último día de aviso: por vencer", () => {
    expect(suretyBondStatus(bond({ expiration_date: "2026-12-20" }), TODAY)).toBe("expiring_soon");
  });

  it("vence un día después de la ventana de aviso: vigente", () => {
    expect(suretyBondStatus(bond({ expiration_date: "2026-12-21" }), TODAY)).toBe("active");
  });

  it("respeta los días de aviso propios de cada póliza", () => {
    expect(suretyBondStatus(bond({ expiration_date: "2026-12-05", notify_days_before: 10 }), TODAY)).toBe("active");
    expect(suretyBondStatus(bond({ expiration_date: "2026-12-05", notify_days_before: 15 }), TODAY)).toBe("expiring_soon");
  });
});

describe("daysUntilExpiration", () => {
  it("devuelve los días que faltan, negativos si ya venció, y null sin vencimiento", () => {
    expect(daysUntilExpiration(bond({ expiration_date: "2026-11-25" }), TODAY)).toBe(5);
    expect(daysUntilExpiration(bond({ expiration_date: "2026-11-18" }), TODAY)).toBe(-2);
    expect(daysUntilExpiration(bond({ expiration_date: null }), TODAY)).toBeNull();
  });
});
