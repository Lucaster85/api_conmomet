"use strict";
// Sugerencia del % de un ajuste con el IPC del INDEC (FLOWS.md §73). La API de datos.gob.ar está simulada.
const { createActor, as } = require("../helpers/auth");

afterEach(() => jest.restoreAllMocks());

const serve = (data) => jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, json: async () => ({ data }) });

describe("GET /invoices/adjustments/ipc", () => {
  it("devuelve la variación entre dos meses", async () => {
    const actor = await createActor({ permissions: ["invoices_read"] });
    serve([["2026-07-01", 12076.3937], ["2026-10-01", 12785.9321]]);
    const res = await as(actor).get("/invoices/adjustments/ipc?from=2026-07&to=2026-10");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ from: "2026-07", to: "2026-10", from_index: 12076.3937, to_index: 12785.9321, percent: 5.88 });
  });

  it("sin mes final usa el último publicado", async () => {
    const actor = await createActor({ permissions: ["invoices_read"] });
    jest.spyOn(global, "fetch")
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [["2026-10-01", 12785.9321]] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [["2026-07-01", 12076.3937], ["2026-10-01", 12785.9321]] }) });
    const res = await as(actor).get("/invoices/adjustments/ipc?from=2026-07");
    expect(res.body.data).toMatchObject({ to: "2026-10", percent: 5.88 });
  });

  it("rechaza meses mal escritos o en mal orden, y un mes que todavía no se publicó", async () => {
    const actor = await createActor({ permissions: ["invoices_read"] });
    expect((await as(actor).get("/invoices/adjustments/ipc?from=julio")).status).toBe(400);
    expect((await as(actor).get("/invoices/adjustments/ipc?from=2026-07&to=2026/10")).status).toBe(400);
    expect((await as(actor).get("/invoices/adjustments/ipc?from=2026-10&to=2026-07")).status).toBe(400);
    serve([["2026-07-01", 12076.3937]]);
    const res = await as(actor).get("/invoices/adjustments/ipc?from=2026-07&to=2026-11");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/todavía no publicó/);
  });

  it("si el INDEC no responde, avisa que se cargue a mano (502)", async () => {
    const actor = await createActor({ permissions: ["invoices_read"] });
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("red caída"));
    const res = await as(actor).get("/invoices/adjustments/ipc?from=2026-07&to=2026-10");
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/a mano/);
  });

  it("pide invoices_read", async () => {
    const without = await createActor({ permissions: ["documents_read"] });
    const admin = await createActor({ role: "admin" });
    serve([["2026-07-01", 100], ["2026-10-01", 110]]);
    expect((await as(without).get("/invoices/adjustments/ipc?from=2026-07&to=2026-10")).status).toBe(401);
    expect((await as(admin).get("/invoices/adjustments/ipc?from=2026-07&to=2026-10")).status).toBe(200);
  });
});
