"use strict";
// Handler final de app.js y límite del upload genérico (FLOWS.md §75.3).
const { app, request, createActor, as } = require("../helpers/auth");

describe("handler final de errores", () => {
  it("JSON mal formado: 400 con mensaje (no HTML)", async () => {
    const res = await request(app).post("/auth/login").set("Content-Type", "application/json").send('{"email": ');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_json");
  });

  it("origen no permitido por CORS: 403 en JSON", async () => {
    const res = await request(app).get("/lookup/roles").set("Origin", "https://sitio-malicioso.example");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("cors_not_allowed");
  });

  it("upload genérico: más de 25 MB responde 413 'El archivo supera los 25 MB.'", async () => {
    const actor = await createActor({ role: "admin" });
    const big = Buffer.alloc(26 * 1024 * 1024, 1);
    const res = await as(actor).post("/media/upload").attach("file", big, "grande.bin");
    expect(res.status).toBe(413);
    expect(res.body.error).toBe("El archivo supera los 25 MB.");
  });

  it("upload genérico: más de 5 archivos responde 400 en JSON", async () => {
    const actor = await createActor({ role: "admin" });
    let req = as(actor).post("/media/upload");
    for (let i = 0; i < 6; i++) req = req.attach("file", Buffer.from("x"), `a${i}.txt`);
    const res = await req;
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("too_many_files");
  });
});
