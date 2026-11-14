"use strict";
// middlewares/publicForm.js sin DB: una mini app de express con las dos defensas de los formularios
// públicos (tope por IP y campo trampa). Lo que se ejercita es el comportamiento, no express-rate-limit.
const express = require("express");
const request = require("supertest");
const { publicRateLimit, honeypot, GENERIC_OK } = require("../../middlewares/publicForm");

function buildApp({ withHoneypot = true } = {}) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  const saved = [];
  const chain = [publicRateLimit()];
  if (withHoneypot) chain.push(honeypot("website"));
  app.post("/form", ...chain, (req, res) => {
    saved.push(req.body);
    res.status(200).json(GENERIC_OK);
  });
  return { app, saved };
}

describe("honeypot", () => {
  beforeEach(() => { process.env.PUBLIC_FORM_RATE_LIMIT_MAX = "100"; });
  afterEach(() => { delete process.env.PUBLIC_FORM_RATE_LIMIT_MAX; });

  it("deja pasar un envío con el campo trampa vacío", async () => {
    const { app, saved } = buildApp();
    const res = await request(app).post("/form").send({ nombre: "Ana", website: "" });
    expect(res.status).toBe(200);
    expect(saved).toHaveLength(1);
  });

  it("deja pasar un envío sin el campo trampa", async () => {
    const { app, saved } = buildApp();
    await request(app).post("/form").send({ nombre: "Ana" });
    expect(saved).toHaveLength(1);
  });

  it("responde el mismo 200 de un envío válido pero no sigue la cadena si el campo viene completo", async () => {
    const { app, saved } = buildApp();
    const res = await request(app).post("/form").send({ nombre: "Bot", website: "http://spam.example" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(GENERIC_OK);
    expect(saved).toHaveLength(0);
  });
});

describe("publicRateLimit", () => {
  afterEach(() => { delete process.env.PUBLIC_FORM_RATE_LIMIT_MAX; });

  it("corta con 429 al pasar el máximo de envíos de la misma IP", async () => {
    process.env.PUBLIC_FORM_RATE_LIMIT_MAX = "2";
    const { app, saved } = buildApp({ withHoneypot: false });

    expect((await request(app).post("/form").send({ n: 1 })).status).toBe(200);
    expect((await request(app).post("/form").send({ n: 2 })).status).toBe(200);
    const blocked = await request(app).post("/form").send({ n: 3 });

    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/Demasiados envíos/);
    expect(saved).toHaveLength(2);
  });

  it("cuenta por IP: otra IP no queda bloqueada por la primera", async () => {
    process.env.PUBLIC_FORM_RATE_LIMIT_MAX = "1";
    const { app } = buildApp({ withHoneypot: false });

    await request(app).post("/form").set("X-Forwarded-For", "10.0.0.1").send({});
    const sameIp = await request(app).post("/form").set("X-Forwarded-For", "10.0.0.1").send({});
    const otherIp = await request(app).post("/form").set("X-Forwarded-For", "10.0.0.2").send({});

    expect(sameIp.status).toBe(429);
    expect(otherIp.status).toBe(200);
  });

  it("cada ruta tiene su propio contador", async () => {
    process.env.PUBLIC_FORM_RATE_LIMIT_MAX = "1";
    const app = express();
    app.use(express.json());
    app.post("/a", publicRateLimit(), (req, res) => res.sendStatus(200));
    app.post("/b", publicRateLimit(), (req, res) => res.sendStatus(200));

    expect((await request(app).post("/a")).status).toBe(200);
    expect((await request(app).post("/a")).status).toBe(429);
    expect((await request(app).post("/b")).status).toBe(200);
  });
});
