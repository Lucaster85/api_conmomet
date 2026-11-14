"use strict";
// Texto de privacidad de "Trabajá con nosotros", versionado y de solo agregar (ver FLOWS.md §63).
// GET /public/job-applications/privacy es público; el ABM vive bajo /system-settings/privacy-texts y lo
// gobierna system_settings_update.
const db = require("../../models");
const { createActor, as, request, app } = require("../helpers/auth");

const seed = (version, content = `Texto v${version}`, extra = {}) => db.ConsentText.create({ kind: "job_application", version, content, ...extra });
const ADMIN = ["system_settings_update"];

describe("GET /public/job-applications/privacy", () => {
  it("devuelve la versión vigente (la de mayor número) sin necesitar sesión", async () => {
    await seed(1, "Viejo");
    await seed(2, "Vigente");

    const res = await request(app).get("/public/job-applications/privacy");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ version: 2, content: "Vigente" });
  });

  it("no expone el historial ni quién lo escribió", async () => {
    const author = await createActor({ permissions: ADMIN });
    await seed(1, "Texto", { created_by: author.user.id });

    const res = await request(app).get("/public/job-applications/privacy");

    expect(Object.keys(res.body.data).sort()).toEqual(["content", "version"]);
  });

  it("responde 404 si todavía no hay ningún texto", async () => {
    const res = await request(app).get("/public/job-applications/privacy");
    expect(res.status).toBe(404);
  });
});

describe("GET /system-settings/privacy-texts", () => {
  it("lista todo el historial, la más nueva primero, con quién la publicó", async () => {
    const actor = await createActor({ permissions: ADMIN });
    await seed(1, "Inicial");
    await seed(2, "Cambio", { created_by: actor.user.id });

    const res = await as(actor).get("/system-settings/privacy-texts");

    expect(res.status).toBe(200);
    expect(res.body.data.map((t) => t.version)).toEqual([2, 1]);
    expect(res.body.data[0].created_by).toMatchObject({ id: actor.user.id });
    expect(res.body.data[1].created_by).toBeNull();
    expect(Number.isNaN(new Date(res.body.data[0].created_at).getTime())).toBe(false);
  });

  it("devuelve 401 sin system_settings_update y deja pasar a admin_granted", async () => {
    const without = await createActor({ permissions: ["users_read"] });
    const admin = await createActor({ role: "admin" });

    expect((await as(without).get("/system-settings/privacy-texts")).status).toBe(401);
    expect((await as(admin).get("/system-settings/privacy-texts")).status).toBe(200);
  });

  it("devuelve 401 sin token", async () => {
    expect((await request(app).get("/system-settings/privacy-texts")).status).toBe(401);
  });
});

describe("POST /system-settings/privacy-texts", () => {
  it("publica una versión nueva (siguiente número) sin tocar las anteriores", async () => {
    const actor = await createActor({ permissions: ADMIN });
    await seed(1, "Inicial");

    const res = await as(actor).post("/system-settings/privacy-texts").send({ content: "  Texto nuevo\r\ncon dos líneas  " });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ version: 2, content: "Texto nuevo\ncon dos líneas", created_by: { id: actor.user.id } });
    const rows = await db.ConsentText.findAll({ order: [["version", "ASC"]] });
    expect(rows.map((r) => [r.version, r.content])).toEqual([[1, "Inicial"], [2, "Texto nuevo\ncon dos líneas"]]);
    expect((await request(app).get("/public/job-applications/privacy")).body.data.version).toBe(2);
  });

  it("arranca en 1 si no había ninguna", async () => {
    const actor = await createActor({ permissions: ADMIN });
    const res = await as(actor).post("/system-settings/privacy-texts").send({ content: "Primero" });
    expect(res.status).toBe(201);
    expect(res.body.data.version).toBe(1);
  });

  it.each([
    ["vacío", "   ", /vacío/],
    ["demasiado largo", "x".repeat(20001), /20000/],
  ])("rechaza con 400 un texto %s", async (_label, content, message) => {
    const actor = await createActor({ permissions: ADMIN });
    await seed(1);

    const res = await as(actor).post("/system-settings/privacy-texts").send({ content });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
    expect(await db.ConsentText.count()).toBe(1);
  });

  it("rechaza con 400 un texto igual al vigente: no ensucia el historial", async () => {
    const actor = await createActor({ permissions: ADMIN });
    await seed(1, "Igual");

    const res = await as(actor).post("/system-settings/privacy-texts").send({ content: "  Igual  " });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/igual al vigente/);
    expect(await db.ConsentText.count()).toBe(1);
  });

  it("permite volver a un texto anterior publicándolo como versión nueva", async () => {
    const actor = await createActor({ permissions: ADMIN });
    await seed(1, "A");
    await seed(2, "B");

    const res = await as(actor).post("/system-settings/privacy-texts").send({ content: "A" });

    expect(res.status).toBe(201);
    expect(res.body.data.version).toBe(3);
  });

  it("dos publicaciones seguidas no repiten número", async () => {
    const actor = await createActor({ permissions: ADMIN });
    await seed(1, "Inicial");

    await as(actor).post("/system-settings/privacy-texts").send({ content: "Uno" });
    await as(actor).post("/system-settings/privacy-texts").send({ content: "Dos" });

    expect((await db.ConsentText.findAll({ order: [["version", "ASC"]] })).map((r) => r.version)).toEqual([1, 2, 3]);
  });

  it("devuelve 401 sin system_settings_update y deja pasar a admin_granted", async () => {
    const without = await createActor({ permissions: ["users_write"] });
    const admin = await createActor({ role: "admin" });

    expect((await as(without).post("/system-settings/privacy-texts").send({ content: "X" })).status).toBe(401);
    expect(await db.ConsentText.count()).toBe(0);
    expect((await as(admin).post("/system-settings/privacy-texts").send({ content: "X" })).status).toBe(201);
  });
});

describe("no hay forma de editar ni borrar una versión", () => {
  it("PUT y DELETE sobre una versión no existen", async () => {
    const actor = await createActor({ role: "admin" });
    const row = await seed(1);

    expect((await as(actor).put(`/system-settings/privacy-texts/${row.id}`).send({ content: "Pisado" })).status).toBe(404);
    expect((await as(actor).delete(`/system-settings/privacy-texts/${row.id}`)).status).toBe(404);
    expect((await db.ConsentText.findByPk(row.id)).content).toBe("Texto v1");
  });
});
