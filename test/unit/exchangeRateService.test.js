"use strict";
const {
  rateDateForPeriod,
  fetchUsdRateForDate,
  fetchCurrentUsdRate,
} = require("../../services/exchangeRateService");

describe("rateDateForPeriod", () => {
  it("1ra quincena: el día siguiente al cierre, dentro del mismo mes", () => {
    expect(rateDateForPeriod({ end_date: "2026-10-15" })).toBe("2026-10-16");
  });

  it("2da quincena: fin de mes rueda al 1° del mes siguiente", () => {
    expect(rateDateForPeriod({ end_date: "2026-10-31" })).toBe("2026-11-01");
  });

  it("2da quincena de febrero bisiesto", () => {
    expect(rateDateForPeriod({ end_date: "2028-02-29" })).toBe("2028-03-01");
  });

  it("diciembre rueda al 1° de enero del año siguiente", () => {
    expect(rateDateForPeriod({ end_date: "2026-12-31" })).toBe("2027-01-01");
  });

  it("acepta end_date como Date además de string", () => {
    expect(rateDateForPeriod({ end_date: new Date("2026-10-15T00:00:00.000Z") })).toBe("2026-10-16");
  });
});

describe("fetchUsdRateForDate", () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it("arma la URL con mes y día con cero a la izquierda", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ casa: "oficial", compra: 1480, venta: 1530, fecha: "2026-01-05" }),
    });
    global.fetch = fetchMock;

    const result = await fetchUsdRateForDate("2026-1-5", { casa: "oficial", side: "venta" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/oficial\/2026\/01\/05$/);
    expect(result).toEqual({ rate: 1530, date: "2026-01-05", casa: "oficial", side: "venta" });
  });

  it("devuelve el lado compra cuando se pide compra", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ casa: "oficial", compra: 1480, venta: 1530 }),
    });

    const result = await fetchUsdRateForDate("2026-10-16", { casa: "oficial", side: "compra" });
    expect(result.rate).toBe(1480);
  });

  it("fecha futura (404) devuelve null, no un error", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });
    const result = await fetchUsdRateForDate("2099-01-01", { casa: "oficial", side: "venta" });
    expect(result).toBeNull();
  });

  it("status 500 devuelve null", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    const result = await fetchUsdRateForDate("2026-10-16", { casa: "oficial", side: "venta" });
    expect(result).toBeNull();
  });

  it("timeout o error de red devuelve null", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("timeout"));
    const result = await fetchUsdRateForDate("2026-10-16", { casa: "oficial", side: "venta" });
    expect(result).toBeNull();
  });

  it("payload sin el campo numérico esperado devuelve null", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ casa: "oficial" }) });
    const result = await fetchUsdRateForDate("2026-10-16", { casa: "oficial", side: "venta" });
    expect(result).toBeNull();
  });
});

describe("fetchCurrentUsdRate", () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it("devuelve la cotización del día con su fecha de actualización", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ moneda: "USD", casa: "oficial", compra: 1480, venta: 1530, fechaActualizacion: "2026-10-16T13:00:00.000Z" }),
    });

    const result = await fetchCurrentUsdRate({ casa: "oficial", side: "venta" });
    expect(result).toEqual({ rate: 1530, fetched_at: "2026-10-16T13:00:00.000Z", casa: "oficial", side: "venta" });
  });

  it("falla silenciosamente ante cualquier error, devuelve null", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("network down"));
    const result = await fetchCurrentUsdRate({ casa: "blue", side: "compra" });
    expect(result).toBeNull();
  });
});
