"use strict";
const { todayInArgentina } = require("../../helpers/argentinaDate");

describe("todayInArgentina", () => {
  it("a las 22 hs de Argentina (01:00 UTC del día siguiente) todavía es el día de Argentina", () => {
    // 2026-11-07T01:00:00Z === 2026-11-06 22:00 en Buenos Aires. toISOString() daría "2026-11-07".
    expect(todayInArgentina(new Date("2026-11-07T01:00:00Z"))).toBe("2026-11-06");
  });

  it("a las 03:00 UTC ya es el día siguiente en Argentina", () => {
    expect(todayInArgentina(new Date("2026-11-07T03:00:00Z"))).toBe("2026-11-07");
  });

  it("a mediodía no hay ambigüedad", () => {
    expect(todayInArgentina(new Date("2026-11-07T15:00:00Z"))).toBe("2026-11-07");
  });

  it("cruza bien el fin de año", () => {
    expect(todayInArgentina(new Date("2027-01-01T02:30:00Z"))).toBe("2026-12-31");
  });

  it("devuelve el formato YYYY-MM-DD", () => {
    expect(todayInArgentina()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
