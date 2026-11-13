"use strict";
// POST /files/signed-urls: firma URLs de corta vida para abrir archivos del bucket privado
// (FLOWS.md "Archivos privados: URLs firmadas"). Solo lleva verifyToken, sin authPermission.
// La firma es offline, así que no se mockea el bucket; las credenciales son falsas.
process.env.STORAGE_PUBLIC_URL = "https://pub-test.r2.dev";
process.env.STORAGE_BUCKET = "bucket-test";
process.env.STORAGE_ACCESS_KEY_ID = "AKIAFAKEFAKEFAKE";
process.env.STORAGE_SECRET_ACCESS_KEY = "fake-secret";
process.env.STORAGE_R2_ENDPOINT = "https://account-id.r2.cloudflarestorage.com";

const request = require("supertest");
const app = require("../../app");
const { createActor, as } = require("../helpers/auth");

const URL_A = "https://pub-test.r2.dev/oca/aaa.pdf";
const URL_B = "https://pub-test.r2.dev/employees/bbb.jpg";

describe("POST /files/signed-urls", () => {
  it("rechaza sin token", async () => {
    const res = await request(app).post("/files/signed-urls").send({ urls: [URL_A] });

    expect(res.status).toBe(401);
  });

  it("devuelve una URL firmada por cada URL guardada", async () => {
    const actor = await createActor();

    const res = await as(actor).post("/files/signed-urls").send({ urls: [URL_A, URL_B] });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual([URL_A, URL_B].sort());
    expect(res.body.data[URL_A]).toContain("X-Amz-Signature=");
    expect(res.body.data[URL_A]).toContain("bucket-test.account-id.r2.cloudflarestorage.com/oca/aaa.pdf");
  });

  it("omite las referencias inválidas y las de backups/", async () => {
    const actor = await createActor();

    const res = await as(actor)
      .post("/files/signed-urls")
      .send({ urls: [URL_A, "https://pub-test.r2.dev/backups/daily/dump.sql.gz", "basura", 123] });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data)).toEqual([URL_A]);
  });

  it("devuelve 400 si urls no es un array", async () => {
    const actor = await createActor();

    const res = await as(actor).post("/files/signed-urls").send({ urls: URL_A });

    expect(res.status).toBe(400);
  });

  it("devuelve 400 si pide más de 50 URLs", async () => {
    const actor = await createActor();
    const urls = Array.from({ length: 51 }, (_, i) => `https://pub-test.r2.dev/oca/${i}.pdf`);

    const res = await as(actor).post("/files/signed-urls").send({ urls });

    expect(res.status).toBe(400);
  });
});
