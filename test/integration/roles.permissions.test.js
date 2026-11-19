"use strict";
// PUT /roles/:id/permissions: no se otorga lo que no se tiene (FLOWS.md §75.1).
const db = require("../../models");
const { createActor, as } = require("../helpers/auth");

let n = 0;
const makeRole = async (level = 50) => {
  n += 1;
  return db.Role.create({ name: `Rol T${Date.now()}${n}`, key: `t_role_${Date.now()}_${n}`, level, is_system: false });
};
const permId = async (name) => (await db.Permission.findOrCreate({ where: { name } }))[0].id;

// Actor de nivel 50 con su propio rol (no de sistema) y permisos particulares.
const actorWithOwnRole = async (permissions) => {
  const role = await makeRole(50);
  const actor = await createActor({ permissions, role: role.key });
  return { role, actor };
};

describe("PUT /roles/:id/permissions", () => {
  it("con roles_update no puede agregar admin_granted al rol propio", async () => {
    const { role, actor } = await actorWithOwnRole(["roles_update"]);
    const res = await as(actor).put(`/roles/${role.id}/permissions`).send({ permissions: [await permId("admin_granted")] });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/admin_granted/);
    expect(await role.countPermissions()).toBe(0);
  });

  it("no puede agregar a un rol de igual nivel un permiso que no tiene", async () => {
    const { actor } = await actorWithOwnRole(["roles_update", "users_read"]);
    const other = await makeRole(50);
    const res = await as(actor).put(`/roles/${other.id}/permissions`).send({ permissions: [await permId("clients_read")] });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/clients_read/);
  });

  it("sí puede agregar un permiso que tiene", async () => {
    const { actor } = await actorWithOwnRole(["roles_update", "users_read"]);
    const other = await makeRole(50);
    const res = await as(actor).put(`/roles/${other.id}/permissions`).send({ permissions: [await permId("users_read")] });
    expect(res.status).toBe(200);
    expect((await other.getPermissions()).map((p) => p.name)).toEqual(["users_read"]);
  });

  it("puede quitar permisos que no tiene", async () => {
    const { actor } = await actorWithOwnRole(["roles_update"]);
    const other = await makeRole(50);
    await other.setPermissions([await permId("clients_read")]);
    const res = await as(actor).put(`/roles/${other.id}/permissions`).send({ permissions: [] });
    expect(res.status).toBe(200);
    expect(await other.countPermissions()).toBe(0);
  });

  it("con admin_granted puede otorgar cualquier permiso", async () => {
    const admin = await createActor({ role: "admin" });
    const other = await makeRole(50);
    const res = await as(admin).put(`/roles/${other.id}/permissions`).send({
      permissions: [await permId("admin_granted"), await permId("clients_read")],
    });
    expect(res.status).toBe(200);
    expect(await other.countPermissions()).toBe(2);
  });
});
