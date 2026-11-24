"use strict";
// POST /roles/:id/duplicate: crear un rol con los permisos de otro (FLOWS.md §84).
const db = require("../../models");
const { createActor, as } = require("../helpers/auth");

let n = 0;
const makeRole = async ({ level = 50, name, has_dashboard_access = true, is_system = false } = {}) => {
  n += 1;
  return db.Role.create({
    name: name || `Rol D${Date.now()}${n}`, key: `d_role_${Date.now()}_${n}`, level, is_system, has_dashboard_access,
  });
};
const permId = async (name) => (await db.Permission.findOrCreate({ where: { name } }))[0].id;
const permNames = async (role) => (await role.getPermissions()).map((p) => p.name).sort();

// Actor de nivel 50 con su propio rol y permisos particulares.
const actorWithOwnRole = async (permissions) => {
  const role = await makeRole({ level: 50 });
  return createActor({ permissions, role: role.key });
};

describe("POST /roles/:id/duplicate", () => {
  it("copia permisos, nivel y acceso al dashboard con el nombre nuevo, sin tocar el original", async () => {
    const actor = await actorWithOwnRole(["roles_write", "roles_update", "employees_read", "employees_write"]);
    const source = await makeRole({ level: 30, name: "Gestión de personal", has_dashboard_access: false });
    await source.setPermissions([await permId("employees_read"), await permId("employees_write")]);

    const res = await as(actor).post(`/roles/${source.id}/duplicate`).send({ name: "  Gestión de personal + facturación  " });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: "Gestión de personal + facturación", level: 30, has_dashboard_access: false, is_system: false });
    expect(res.body.data.id).not.toBe(source.id);
    expect(res.body.data.key).not.toBe(source.key);
    expect(res.body.data.permissions.map((p) => p.name).sort()).toEqual(["employees_read", "employees_write"]);

    const copy = await db.Role.findByPk(res.body.data.id);
    expect(await permNames(copy)).toEqual(["employees_read", "employees_write"]);
    // El original queda igual.
    await source.reload();
    expect(source.name).toBe("Gestión de personal");
    expect(await permNames(source)).toEqual(["employees_read", "employees_write"]);

    // Los permisos de la copia son independientes: agregarle uno no toca al original.
    await copy.addPermission(await permId("invoices_read"));
    expect(await permNames(source)).toEqual(["employees_read", "employees_write"]);
  });

  it("permite cambiar nivel y acceso al duplicar", async () => {
    const actor = await actorWithOwnRole(["roles_write", "roles_update"]);
    const source = await makeRole({ level: 30, has_dashboard_access: true });
    const res = await as(actor).post(`/roles/${source.id}/duplicate`).send({ name: "Otro", level: 20, has_dashboard_access: false });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ level: 20, has_dashboard_access: false });
  });

  it("duplicar un rol de sistema da un rol que NO es de sistema", async () => {
    const admin = await createActor({ role: "admin" });
    const operario = await db.Role.findOne({ where: { key: "operario" } });
    const res = await as(admin).post(`/roles/${operario.id}/duplicate`).send({ name: "Operario con extras" });
    expect(res.status).toBe(201);
    expect(res.body.data.is_system).toBe(false);
    expect(res.body.data.key).not.toBe("operario");
  });

  it("con roles_write pero sin roles_update no puede duplicar (copiar permisos es asignarlos)", async () => {
    const actor = await actorWithOwnRole(["roles_write"]);
    const source = await makeRole({ level: 30 });
    const before = await db.Role.count();
    const res = await as(actor).post(`/roles/${source.id}/duplicate`).send({ name: "Copia" });
    expect(res.status).toBe(401);
    expect(await db.Role.count()).toBe(before);
  });

  it("sin roles_write no puede duplicar", async () => {
    const actor = await actorWithOwnRole(["roles_update"]);
    const source = await makeRole({ level: 30 });
    const res = await as(actor).post(`/roles/${source.id}/duplicate`).send({ name: "Copia" });
    expect(res.status).toBe(401);
  });

  it("con admin_granted puede duplicar", async () => {
    const admin = await createActor({ role: "admin" });
    const source = await makeRole({ level: 30 });
    await source.setPermissions([await permId("clients_read")]);
    const res = await as(admin).post(`/roles/${source.id}/duplicate`).send({ name: "Copia admin" });
    expect(res.status).toBe(201);
  });

  it("no duplica un rol de nivel superior al del actor", async () => {
    const actor = await actorWithOwnRole(["roles_write", "roles_update"]);
    const higher = await makeRole({ level: 80 });
    const before = await db.Role.count();
    const res = await as(actor).post(`/roles/${higher.id}/duplicate`).send({ name: "Copia" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/nivel superior/);
    expect(await db.Role.count()).toBe(before);
  });

  it("no duplica si el rol incluye permisos que el actor no tiene, y no deja nada creado", async () => {
    const actor = await actorWithOwnRole(["roles_write", "roles_update", "users_read"]);
    const source = await makeRole({ level: 30 });
    await source.setPermissions([await permId("users_read"), await permId("clients_read")]);
    const before = await db.Role.count();
    const res = await as(actor).post(`/roles/${source.id}/duplicate`).send({ name: "Copia" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/clients_read/);
    expect(res.body.error).not.toMatch(/users_read/);
    expect(await db.Role.count()).toBe(before);
  });

  it("el nivel pedido no puede superar el del actor", async () => {
    const actor = await actorWithOwnRole(["roles_write", "roles_update"]);
    const source = await makeRole({ level: 30 });
    const res = await as(actor).post(`/roles/${source.id}/duplicate`).send({ name: "Copia", level: 60 });
    expect(res.status).toBe(403);
  });

  it("rechaza nombre vacío, en blanco o de más de 50 caracteres", async () => {
    const actor = await actorWithOwnRole(["roles_write", "roles_update"]);
    const source = await makeRole({ level: 30 });
    const before = await db.Role.count();
    for (const name of [undefined, "", "   ", "x".repeat(51), 123]) {
      const res = await as(actor).post(`/roles/${source.id}/duplicate`).send({ name });
      expect(res.status).toBe(400);
    }
    expect(await db.Role.count()).toBe(before);
  });

  it("rechaza has_dashboard_access que no sea booleano", async () => {
    const actor = await actorWithOwnRole(["roles_write", "roles_update"]);
    const source = await makeRole({ level: 30 });
    const res = await as(actor).post(`/roles/${source.id}/duplicate`).send({ name: "Copia", has_dashboard_access: "no" });
    expect(res.status).toBe(400);
  });

  it("devuelve 404 si el rol a duplicar no existe", async () => {
    const actor = await actorWithOwnRole(["roles_write", "roles_update"]);
    const res = await as(actor).post("/roles/999999/duplicate").send({ name: "Copia" });
    expect(res.status).toBe(404);
  });

  it("un rol sin permisos se duplica sin permisos", async () => {
    const actor = await actorWithOwnRole(["roles_write", "roles_update"]);
    const source = await makeRole({ level: 30 });
    const res = await as(actor).post(`/roles/${source.id}/duplicate`).send({ name: "Vacío" });
    expect(res.status).toBe(201);
    expect(res.body.data.permissions).toEqual([]);
  });
});
