"use strict";
const { stripArcaSecrets } = require("../../services/arca/sanitize");

describe("arca stripArcaSecrets (S2)", () => {
  it("quita Token, Sign y Auth en cualquier nivel, sin mutar el original", () => {
    const raw = {
      Auth: { Token: "t", Sign: "s", Cuit: 1 },
      FeCAEReq: { FeCabReq: { PtoVta: 3 }, nested: [{ token: "x", ok: 1 }] },
      in0: "cms",
    };
    const clean = stripArcaSecrets(raw);
    expect(JSON.stringify(clean)).not.toMatch(/Token|Sign|"t"|"s"|cms|"x"/);
    expect(clean.FeCAEReq.FeCabReq.PtoVta).toBe(3);
    expect(clean.FeCAEReq.nested[0]).toEqual({ ok: 1 });
    expect(raw.Auth.Token).toBe("t");
  });
});
