"use strict";
// El hash de la contraseña no sale en ninguna respuesta (FLOWS.md §75.1).
const db = require("../../models");
const { encryptPass } = require("../../helpers");
const { createActor, as, request, app } = require("../helpers/auth");

const hasPassword = (body) => JSON.stringify(body).includes('"password"');

describe("la contraseña no se devuelve", () => {
  it("GET /users y GET /users/:id", async () => {
    const actor = await createActor({ permissions: ["users_read"] });
    const list = await as(actor).get("/users");
    expect(list.status).toBe(200);
    expect(hasPassword(list.body)).toBe(false);
    const one = await as(actor).get(`/users/${actor.user.id}`);
    expect(hasPassword(one.body)).toBe(false);
  });

  it("POST /users y PUT /users/:id", async () => {
    const actor = await createActor({ permissions: ["users_write", "users_update"] });
    const role = await db.Role.findOne({ where: { key: "test_role_empty" } });
    const created = await as(actor).post("/users").send({
      name: "Nuevo", lastname: "Usuario", email: `nuevo${Date.now()}@test.local`, cuit: String(27000000000 + (Date.now() % 1e8)), role_id: role.id,
    });
    expect(created.status).toBe(201);
    expect(hasPassword(created.body)).toBe(false);
    expect(created.body.generatedPassword).toBeTruthy();

    const updated = await as(actor).put(`/users/${created.body.data.id}`).send({ name: "Otro" });
    expect(updated.status).toBe(200);
    expect(hasPassword(updated.body)).toBe(false);
  });

  it("el login sigue funcionando (verifica el hash) y no lo devuelve", async () => {
    const role = await db.Role.findOne({ where: { key: "test_role_empty" } });
    const email = `login${Date.now()}@test.local`;
    await db.User.create({
      name: "Log", lastname: "In", email, password: await encryptPass("Clave-correcta-1"),
      role_id: role.id, cuit: String(23000000000 + (Date.now() % 1e8)),
    });

    const ok = await request(app).post("/auth/login").send({ email, password: "Clave-correcta-1" });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();
    expect(hasPassword(ok.body)).toBe(false);

    const bad = await request(app).post("/auth/login").send({ email, password: "otra" });
    expect(bad.status).toBe(401);
  });

  it("PUT /me/password verifica la contraseña actual con el hash real", async () => {
    const role = await db.Role.findOne({ where: { key: "test_role_empty" } });
    const user = await db.User.create({
      name: "Cam", lastname: "Bio", email: `cambio${Date.now()}@test.local`, password: await encryptPass("Clave-vieja-123"),
      role_id: role.id, cuit: String(24000000000 + (Date.now() % 1e8)),
    });
    const { mintToken } = require("../helpers/auth");
    const actor = { token: mintToken(user) };
    const wrong = await as(actor).put("/me/password").send({ currentPassword: "mala", newPassword: "Clave-nueva-123" });
    expect(wrong.status).toBe(401);
    const ok = await as(actor).put("/me/password").send({ currentPassword: "Clave-vieja-123", newPassword: "Clave-nueva-123" });
    expect(ok.status).toBe(200);
  });
});
