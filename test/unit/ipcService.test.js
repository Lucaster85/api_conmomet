"use strict";
// IPC del INDEC para sugerir el % de un ajuste (services/ipcService.js, FLOWS.md §73). La red está simulada.
const { parseSeries, ipcVariation, fetchIpcSeries, fetchLatestIpcMonth, isMonth } = require("../../services/ipcService");

const SERIES = { "2026-07": 12076.3937, "2026-08": 12276.766, "2026-09": 12514.1508, "2026-10": 12785.9321 };

describe("parseSeries", () => {
  it("convierte las filas de la API en un mapa por mes", () => {
    expect(parseSeries({ data: [["2026-10-01", 12785.9321], ["2026-09-01", 12514.1508]] })).toEqual({ "2026-10": 12785.9321, "2026-09": 12514.1508 });
  });

  it("ignora filas inválidas y devuelve null si no queda ninguna o el payload es otro", () => {
    expect(parseSeries({ data: [["2026-10-01", null], ["x"], "basura", ["2026-09-01", 0]] })).toBeNull();
    expect(parseSeries({ data: [] })).toBeNull();
    expect(parseSeries({})).toBeNull();
    expect(parseSeries(null)).toBeNull();
  });
});

describe("ipcVariation", () => {
  it("es el cociente de los índices, no la suma de las variaciones mensuales", () => {
    expect(ipcVariation(SERIES, "2026-07", "2026-10")).toEqual({ from: "2026-07", to: "2026-10", from_index: 12076.3937, to_index: 12785.9321, percent: 5.88 });
  });

  it("un mes de diferencia", () => {
    expect(ipcVariation(SERIES, "2026-09", "2026-10").percent).toBe(2.17);
  });

  it("valida el formato y el orden de los meses", () => {
    expect(ipcVariation(SERIES, "2026-7", "2026-10").error).toMatch(/AAAA-MM/);
    expect(ipcVariation(SERIES, "2026-10", "2026-10").error).toMatch(/anterior/);
    expect(ipcVariation(SERIES, "2026-10", "2026-07").error).toMatch(/anterior/);
  });

  it("avisa si el mes final todavía no se publicó o el base no existe", () => {
    expect(ipcVariation(SERIES, "2026-07", "2026-11").error).toMatch(/todavía no publicó.*último disponible es 2026-10/);
    expect(ipcVariation(SERIES, "2025-01", "2026-10").error).toMatch(/no tiene publicado/);
  });
});

describe("isMonth", () => {
  it("acepta AAAA-MM válidos", () => {
    expect(isMonth("2026-01")).toBe(true);
    expect(isMonth("2026-12")).toBe(true);
    expect(["2026-13", "2026-00", "2026-1", "26-01", "2026-01-01", null, 202601].some(isMonth)).toBe(false);
  });
});

describe("fetchIpcSeries / fetchLatestIpcMonth", () => {
  afterEach(() => jest.restoreAllMocks());
  const respond = (body, ok = true) => jest.spyOn(global, "fetch").mockResolvedValue({ ok, json: async () => body });

  it("pide el rango y devuelve la serie", async () => {
    const spy = respond({ data: [["2026-09-01", 100], ["2026-10-01", 102]] });
    expect(await fetchIpcSeries("2026-09", "2026-10")).toEqual({ "2026-09": 100, "2026-10": 102 });
    expect(spy.mock.calls[0][0]).toContain("start_date=2026-09");
    expect(spy.mock.calls[0][0]).toContain("end_date=2026-10");
  });

  it("devuelve null ante un status de error, una red caída o un payload raro", async () => {
    respond({}, false);
    expect(await fetchIpcSeries("2026-09", "2026-10")).toBeNull();
    jest.restoreAllMocks();
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("timeout"));
    expect(await fetchIpcSeries("2026-09", "2026-10")).toBeNull();
    expect(await fetchLatestIpcMonth()).toBeNull();
    jest.restoreAllMocks();
    respond({ data: "nada" });
    expect(await fetchIpcSeries("2026-09", "2026-10")).toBeNull();
  });

  it("el último mes publicado sale de la serie ordenada", async () => {
    respond({ data: [["2026-10-01", 12785.93]] });
    expect(await fetchLatestIpcMonth()).toBe("2026-10");
  });
});
