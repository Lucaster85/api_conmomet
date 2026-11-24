"use strict";
const express = require("express");
const request = require("supertest");
const { verifyCronSecret } = require("../../middlewares/cronSecret");

const app = express();
app.post("/cron", verifyCronSecret, (req, res) => res.status(200).json({ ok: true }));

describe("verifyCronSecret", () => {
  afterEach(() => { delete process.env.CRON_SECRET; });

  it("sin CRON_SECRET el endpoint queda cerrado (503), incluso con 'Bearer undefined'", async () => {
    expect((await request(app).post("/cron")).status).toBe(503);
    expect((await request(app).post("/cron").set("Authorization", "Bearer undefined")).status).toBe(503);
    expect((await request(app).post("/cron").set("Authorization", "Bearer ")).status).toBe(503);
  });

  it("con CRON_SECRET: sin header o con otro valor responde 401", async () => {
    process.env.CRON_SECRET = "secreto-largo";
    expect((await request(app).post("/cron")).status).toBe(401);
    expect((await request(app).post("/cron").set("Authorization", "Bearer otro")).status).toBe(401);
    expect((await request(app).post("/cron").set("Authorization", "secreto-largo")).status).toBe(401);
  });

  it("con el secret correcto pasa", async () => {
    process.env.CRON_SECRET = "secreto-largo";
    expect((await request(app).post("/cron").set("Authorization", "Bearer secreto-largo")).status).toBe(200);
  });
});
