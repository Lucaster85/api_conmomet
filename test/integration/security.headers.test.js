"use strict";
// Cabeceras de seguridad de la API (FLOWS.md §75.4).
const { app, request } = require("../helpers/auth");

describe("cabeceras de seguridad", () => {
  it("la API manda nosniff, X-Frame-Options, Referrer-Policy y no expone X-Powered-By", async () => {
    const res = await request(app).get("/lookup/roles");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBeDefined();
    expect(res.headers["referrer-policy"]).toBeDefined();
    expect(res.headers["strict-transport-security"]).toBeDefined();
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["cross-origin-resource-policy"]).toBe("cross-origin");
  });
});
