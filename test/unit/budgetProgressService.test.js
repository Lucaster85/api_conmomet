"use strict";
// Avance real de obra (services/budgetProgressService.js, FLOWS.md §72): qué cuenta y la regla de avance acumulado.
const { currentProgress, monotonicError, isCounted } = require("../../services/budgetProgressService");

let id = 0;
const entry = (over = {}) => ({ id: ++id, date: "2026-11-10", percent: 30, source: "manual", status: null, certificate_number: null, ...over });
const cert = (over = {}) => entry({ source: "certificate", certificate_number: "C-1", status: "approved", ...over });

describe("isCounted", () => {
  it("cuentan las cargadas a mano y los certificados aprobados; no los presentados ni los rechazados", () => {
    expect(isCounted(entry())).toBe(true);
    expect(isCounted(cert())).toBe(true);
    expect(isCounted(cert({ status: "presented" }))).toBe(false);
    expect(isCounted(cert({ status: "rejected" }))).toBe(false);
  });
});

describe("currentProgress", () => {
  it("sin mediciones que cuenten, no hay avance real", () => {
    expect(currentProgress([])).toBeNull();
    expect(currentProgress([cert({ status: "presented" }), cert({ status: "rejected" })])).toBeNull();
  });

  it("es la última medición que cuenta por fecha, con el porcentaje como número", () => {
    const list = [entry({ date: "2026-10-01", percent: "20.00" }), cert({ date: "2026-11-05", percent: "45.50", certificate_number: "C-7" }), entry({ date: "2026-09-01", percent: 5 })];
    expect(currentProgress(list)).toMatchObject({ percent: 45.5, date: "2026-11-05", source: "certificate", certificate_number: "C-7" });
  });

  it("a igual fecha gana la última cargada, y un certificado presentado posterior no pisa al vigente", () => {
    const first = entry({ date: "2026-11-10", percent: 30 });
    const second = entry({ date: "2026-11-10", percent: 35 });
    expect(currentProgress([second, first]).percent).toBe(35);
    expect(currentProgress([first, cert({ date: "2026-11-20", percent: 60, status: "presented" })]).percent).toBe(30);
  });
});

describe("monotonicError (el avance es acumulado)", () => {
  const others = [entry({ date: "2026-10-01", percent: 20 }), entry({ date: "2026-12-01", percent: 60 })];

  it("acepta un valor entre el anterior y el posterior", () => {
    expect(monotonicError(others, { date: "2026-11-01", percent: 40 })).toBeNull();
    expect(monotonicError(others, { date: "2026-11-01", percent: 20 })).toBeNull();
  });

  it("rechaza uno menor al de una medición anterior", () => {
    expect(monotonicError(others, { date: "2026-11-01", percent: 10 })).toMatch(/01\/10\/2026.*20%/);
  });

  it("rechaza uno mayor al de una medición posterior", () => {
    expect(monotonicError(others, { date: "2026-11-01", percent: 70 })).toMatch(/01\/12\/2026.*60%/);
  });

  it("ignora las que no cuentan y las de la misma fecha", () => {
    expect(monotonicError([cert({ date: "2026-10-01", percent: 90, status: "rejected" })], { date: "2026-11-01", percent: 10 })).toBeNull();
    expect(monotonicError([entry({ date: "2026-11-01", percent: 90 })], { date: "2026-11-01", percent: 10 })).toBeNull();
  });
});
