"use strict";
// Helpers de autenticación para supertest. mintToken usa el createToken REAL de helpers/jwt.js
// (no jwt.sign a mano): la resolución del secret es parte de lo que queremos ejercitar.
const request = require("supertest");
const app = require("../../app");
const db = require("../../models");
const { createToken } = require("../../helpers/jwt");

let counter = 0;
function nextId() {
  counter += 1;
  return counter;
}

function mintToken(user) {
  return createToken(user);
}

/**
 * Crea un usuario de test con los permisos indicados colgados DIRECTO del usuario (no del
 * rol): authPermission une permisos de rol + permisos de usuario (middlewares/auth.js), así
 * que alcanza para expresar cualquier combinación de la matriz sin tocar los roles fijos.
 *
 * `role: 'admin'` da el bypass total (admin_granted, vía el rol sembrado por runSeed).
 * `role: 'test_role_empty'` (default de ningún permiso) o 'test_role_custom' son los otros dos
 * roles fijos de test/setup/globalSetup.js.
 *
 * La password no es un hash real: ningún test pega al login, nadie la verifica — hashearla con
 * bcrypt (12 rounds) solo pagaría costo sin motivo.
 */
async function createActor({ permissions = [], role = "test_role_empty" } = {}) {
  const roleRow = await db.Role.findOne({ where: { key: role } });
  if (!roleRow) {
    throw new Error(`Rol de test "${role}" no existe — ¿corrió globalSetup antes de este test?`);
  }

  const n = nextId();
  const user = await db.User.create({
    name: "Test",
    lastname: `Actor${n}`,
    email: `actor${n}@test.local`,
    password: "no-es-un-hash-nadie-lo-verifica",
    role_id: roleRow.id,
    cuit: String(20000000000 + n),
    phone: "1111111111",
  });

  for (const name of permissions) {
    const [permission] = await db.Permission.findOrCreate({ where: { name } });
    await user.addPermission(permission);
  }

  // Releer con los includes que `verifyToken` espera (role.permissions + permissions), para que
  // lo que devuelve createActor sea equivalente a `req.user` dentro de un controller.
  const full = await db.User.findByPk(user.id, {
    include: [
      { model: db.Role, as: "role", include: [{ model: db.Permission, as: "permissions" }] },
      { model: db.Permission, as: "permissions" },
    ],
  });

  return { user: full, token: mintToken(full) };
}

// Azúcar sobre supertest: as(actor).get('/budgets/1') === request(app).get('/budgets/1')
// con el Authorization header ya puesto.
function as(actor) {
  const authed = (req) => req.set("Authorization", `Bearer ${actor.token}`);
  return {
    get: (path) => authed(request(app).get(path)),
    post: (path) => authed(request(app).post(path)),
    put: (path) => authed(request(app).put(path)),
    patch: (path) => authed(request(app).patch(path)),
    delete: (path) => authed(request(app).delete(path)),
  };
}

module.exports = { app, request, mintToken, createActor, as };
