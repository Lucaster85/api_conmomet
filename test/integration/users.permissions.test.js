"use strict";
// Permisos particulares de un usuario (FLOWS.md §75.1): los ve y los asigna solo admin_granted.
const db = require("../../models");
const { createActor, as } = require("../helpers/auth");

const permId = async (name) => (await db.Permission.findOrCreate({ where: { name } }))[0].id;

describe("PUT /users/:id/permissions", () => {
  it("con users_update (sin admin_granted) responde 401 sobre otro usuario", async () => {
    const actor = await createActor({ permissions: ["users_update"] });
    const target = await createActor();
    const res = await as(actor).put(`/users/${target.user.id}/permissions`).send({ permissions: [await permId("users_read")] });
    expect(res.status).toBe(401);
  });

  it("con users_update (sin admin_granted) tampoco puede tocar su propia ficha", async () => {
    const actor = await createActor({ permissions: ["users_update"] });
    const res = await as(actor).put(`/users/${actor.user.id}/permissions`).send({ permissions: [await permId("admin_granted")] });
    expect(res.status).toBe(401);
    const fresh = await db.User.findByPk(actor.user.id, { include: "permissions" });
    expect(fresh.permissions.map((p) => p.name)).not.toContain("admin_granted");
  });

  it("con admin_granted asigna los permisos", async () => {
    const admin = await createActor({ role: "admin" });
    const target = await createActor();
    const id = await permId("users_read");
    const res = await as(admin).put(`/users/${target.user.id}/permissions`).send({ permissions: [id] });
    expect(res.status).toBe(200);
    expect(res.body.data.permissions.map((p) => p.name)).toEqual(["users_read"]);
  });
});

describe("GET /users y /users/:id: permisos particulares", () => {
  it("sin admin_granted no trae `permissions` (sí los del rol)", async () => {
    const actor = await createActor({ permissions: ["users_read"] });
    await createActor({ permissions: ["clients_read"] });

    const list = await as(actor).get("/users");
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThan(1);
    for (const u of list.body.data) {
      expect(u).not.toHaveProperty("permissions");
      expect(u.role).toHaveProperty("permissions");
    }

    const one = await as(actor).get(`/users/${actor.user.id}`);
    expect(one.status).toBe(200);
    expect(one.body.data).not.toHaveProperty("permissions");
  });

  it("con admin_granted sí trae los permisos particulares", async () => {
    const admin = await createActor({ role: "admin" });
    await createActor({ permissions: ["clients_read"] });
    const list = await as(admin).get("/users");
    expect(list.status).toBe(200);
    const withPerm = list.body.data.find((u) => (u.permissions || []).some((p) => p.name === "clients_read"));
    expect(withPerm).toBeDefined();
  });
});

describe("rutas de permisos eliminadas / protegidas", () => {
  it("PUT /permissions/:id y POST /permissions_assign ya no existen", async () => {
    const admin = await createActor({ role: "admin" });
    const id = await permId("users_read");
    expect((await as(admin).put(`/permissions/${id}`).send({ name: "x" })).status).toBe(404);
    expect((await as(admin).post("/permissions_assign").send({ type: "user", id: admin.user.id, permissions: [id] })).status).toBe(404);
  });

  it("DELETE /permissions/:id de un permiso base exige admin_granted", async () => {
    const actor = await createActor({ permissions: ["permissions_delete"] });
    const id = await permId("admin_granted");
    const res = await as(actor).delete(`/permissions/${id}`);
    expect(res.status).toBe(403);
    expect(await db.Permission.findByPk(id)).not.toBeNull();
  });

  it("DELETE /permissions/:id de un permiso propio (no base) se permite", async () => {
    const actor = await createActor({ permissions: ["permissions_delete"] });
    const custom = await db.Permission.create({ name: `custom_${Date.now()}_perm` });
    const res = await as(actor).delete(`/permissions/${custom.id}`);
    expect(res.status).toBe(200);
  });
});
