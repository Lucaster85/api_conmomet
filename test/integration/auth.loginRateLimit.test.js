"use strict";
// Cableado real: POST /auth/login y PUT /me/password cortan con 429 tras los intentos fallidos (FLOWS.md §75.2).
const { app, request, createActor, as } = require("../helpers/auth");

describe("límite de intentos fallidos", () => {
  beforeEach(() => { process.env.LOGIN_RATE_LIMIT_MAX = "2"; });
  afterEach(() => { delete process.env.LOGIN_RATE_LIMIT_MAX; });

  it("POST /auth/login responde 429 al 3.er intento fallido del mismo email", async () => {
    const ip = "10.20.30.1";
    const email = `nadie${Date.now()}@test.local`;
    const post = () => request(app).post("/auth/login").set("X-Forwarded-For", ip).send({ email, password: "mala" });
    expect((await post()).status).toBe(401);
    expect((await post()).status).toBe(401);
    const blocked = await post();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/Demasiados intentos/);
  });

  it("PUT /me/password responde 429 tras los intentos fallidos con la contraseña actual", async () => {
    const actor = await createActor();
    const put = () => as(actor).put("/me/password").send({ currentPassword: "mala", newPassword: "Clave-nueva-123" });
    expect((await put()).status).toBe(401);
    expect((await put()).status).toBe(401);
    expect((await put()).status).toBe(429);
  });
});
