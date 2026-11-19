"use strict";
// middlewares/loginRateLimit.js sin DB: mini app con un "login" que acepta solo la clave correcta.
const express = require("express");
const request = require("supertest");
const { createLoginRateLimit } = require("../../middlewares/loginRateLimit");

function buildApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.post("/login", ...createLoginRateLimit(), (req, res) =>
    req.body.password === "ok" ? res.status(200).json({ token: "t" }) : res.status(401).json({ error: "mal" })
  );
  return app;
}

describe("loginRateLimit", () => {
  beforeEach(() => { process.env.LOGIN_RATE_LIMIT_MAX = "5"; process.env.LOGIN_RATE_LIMIT_IP_MAX = "30"; });
  afterEach(() => { delete process.env.LOGIN_RATE_LIMIT_MAX; delete process.env.LOGIN_RATE_LIMIT_IP_MAX; });

  it("corta en el 6.º intento fallido del mismo email", async () => {
    const app = buildApp();
    for (let i = 0; i < 5; i++) {
      expect((await request(app).post("/login").send({ email: "a@x.com", password: "mal" })).status).toBe(401);
    }
    const blocked = await request(app).post("/login").send({ email: "a@x.com", password: "mal" });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/Demasiados intentos/);
  });

  it("normaliza el email (mayúsculas y espacios cuentan como el mismo)", async () => {
    const app = buildApp();
    for (let i = 0; i < 5; i++) await request(app).post("/login").send({ email: " A@X.com ", password: "mal" });
    expect((await request(app).post("/login").send({ email: "a@x.com", password: "mal" })).status).toBe(429);
  });

  it("un login exitoso no consume intentos", async () => {
    const app = buildApp();
    for (let i = 0; i < 4; i++) await request(app).post("/login").send({ email: "a@x.com", password: "mal" });
    for (let i = 0; i < 10; i++) {
      expect((await request(app).post("/login").send({ email: "a@x.com", password: "ok" })).status).toBe(200);
    }
    expect((await request(app).post("/login").send({ email: "a@x.com", password: "mal" })).status).toBe(401);
  });

  it("otro email desde la misma IP sigue pudiendo intentar", async () => {
    const app = buildApp();
    for (let i = 0; i < 6; i++) await request(app).post("/login").send({ email: "a@x.com", password: "mal" });
    expect((await request(app).post("/login").send({ email: "b@x.com", password: "ok" })).status).toBe(200);
  });

  it("el tope por IP frena el barrido de muchos emails", async () => {
    process.env.LOGIN_RATE_LIMIT_IP_MAX = "3";
    const app = buildApp();
    for (let i = 0; i < 3; i++) await request(app).post("/login").send({ email: `u${i}@x.com`, password: "mal" });
    expect((await request(app).post("/login").send({ email: "u9@x.com", password: "mal" })).status).toBe(429);
  });

  it("otra IP no queda bloqueada", async () => {
    const app = buildApp();
    for (let i = 0; i < 6; i++) await request(app).post("/login").set("X-Forwarded-For", "10.0.0.1").send({ email: "a@x.com", password: "mal" });
    expect((await request(app).post("/login").set("X-Forwarded-For", "10.0.0.2").send({ email: "a@x.com", password: "mal" })).status).toBe(401);
  });
});
