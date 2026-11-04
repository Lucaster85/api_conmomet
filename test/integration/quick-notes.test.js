"use strict";
// Notas rápidas personales (ver FLOWS.md, flujo de Notas rápidas). Las rutas viven en /me/*, sin
// authPermission: no hay matriz de permisos que ejercitar, así que acá se cubre lo que sí es la
// barrera real — que cada usuario solo vea y toque sus propias notas — más el ciclo de vida
// (completar/reabrir, eliminar/restaurar), las validaciones y que el vínculo a entidades esté
// cerrado (preparado en el schema, pero no habilitado).
const db = require("../../models");
const { createActor, as } = require("../helpers/auth");

async function createNote(actor, body = {}) {
  const res = await as(actor).post("/me/quick-notes").send({ content: "Llamar al proveedor", ...body });
  expect(res.status).toBe(201);
  return res.body.data;
}

describe("POST /me/quick-notes", () => {
  it("crea una nota pendiente del usuario del token", async () => {
    const actor = await createActor();

    const res = await as(actor).post("/me/quick-notes").send({ content: "  Pedir caños  " });

    expect(res.status).toBe(201);
    expect(res.body.data.content).toBe("Pedir caños");
    expect(res.body.data.completed_at).toBeNull();
    expect(res.body.data.due_date).toBeNull();
    const row = await db.QuickNote.findByPk(res.body.data.id);
    expect(row.user_id).toBe(actor.user.id);
  });

  it("guarda el vencimiento cuando se envía", async () => {
    const actor = await createActor();

    const note = await createNote(actor, { due_date: "2026-12-24" });

    expect(note.due_date).toBe("2026-12-24");
  });

  it("devuelve created_at en snake_case y entity en null", async () => {
    const actor = await createActor();

    const note = await createNote(actor);

    expect(typeof note.created_at).toBe("string");
    expect(note.createdAt).toBeUndefined();
    expect(note.entity).toBeNull();
  });

  it("ignora un user_id enviado en el body: la nota es del usuario del token", async () => {
    const actor = await createActor();
    const other = await createActor();

    const res = await as(actor).post("/me/quick-notes").send({ content: "Mía", user_id: other.user.id });

    expect(res.status).toBe(201);
    const row = await db.QuickNote.findByPk(res.body.data.id);
    expect(row.user_id).toBe(actor.user.id);
  });

  it("rechaza con 400 un texto vacío o solo con espacios", async () => {
    const actor = await createActor();

    const empty = await as(actor).post("/me/quick-notes").send({ content: "" });
    const blanks = await as(actor).post("/me/quick-notes").send({ content: "   " });
    const missing = await as(actor).post("/me/quick-notes").send({});

    expect(empty.status).toBe(400);
    expect(blanks.status).toBe(400);
    expect(missing.status).toBe(400);
  });

  it("rechaza con 400 un texto de más de 2000 caracteres y acepta uno de exactamente 2000", async () => {
    const actor = await createActor();

    const tooLong = await as(actor).post("/me/quick-notes").send({ content: "a".repeat(2001) });
    const justRight = await as(actor).post("/me/quick-notes").send({ content: "a".repeat(2000) });

    expect(tooLong.status).toBe(400);
    expect(justRight.status).toBe(201);
  });

  it("rechaza con 400 un vencimiento con formato inválido o una fecha que no existe", async () => {
    const actor = await createActor();

    const badFormat = await as(actor).post("/me/quick-notes").send({ content: "x", due_date: "24/12/2026" });
    const notADate = await as(actor).post("/me/quick-notes").send({ content: "x", due_date: "2026-02-31" });
    const notAString = await as(actor).post("/me/quick-notes").send({ content: "x", due_date: 20261224 });

    expect(badFormat.status).toBe(400);
    expect(notADate.status).toBe(400);
    expect(notAString.status).toBe(400);
  });

  it("rechaza sin token con 401", async () => {
    const { request, app } = require("../helpers/auth");
    const res = await request(app).post("/me/quick-notes").send({ content: "x" });

    expect(res.status).toBe(401);
  });

  it("funciona para un usuario sin ningún permiso", async () => {
    const actor = await createActor({ permissions: [] });

    const res = await as(actor).post("/me/quick-notes").send({ content: "Sin permisos" });

    expect(res.status).toBe(201);
  });

  it("funciona para un admin igual que para cualquiera (sin bypass sobre notas ajenas)", async () => {
    const admin = await createActor({ role: "admin" });

    const res = await as(admin).post("/me/quick-notes").send({ content: "Del admin" });

    expect(res.status).toBe(201);
  });
});

describe("POST /me/quick-notes — vínculo a entidades (preparado, no habilitado)", () => {
  it("rechaza con 400 un entity_type + entity_id: la lista blanca está vacía", async () => {
    const actor = await createActor();

    const res = await as(actor).post("/me/quick-notes").send({
      content: "Sobre el presupuesto",
      entity_type: "budget",
      entity_id: 1,
    });

    expect(res.status).toBe(400);
    expect(await db.QuickNote.count()).toBe(0);
  });

  it("rechaza con 400 enviar solo uno de los dos campos del vínculo", async () => {
    const actor = await createActor();

    const onlyType = await as(actor).post("/me/quick-notes").send({ content: "x", entity_type: "budget" });
    const onlyId = await as(actor).post("/me/quick-notes").send({ content: "x", entity_id: 1 });

    expect(onlyType.status).toBe(400);
    expect(onlyId.status).toBe(400);
  });

  it("rechaza con 400 también al editar una nota existente", async () => {
    const actor = await createActor();
    const note = await createNote(actor);

    const res = await as(actor).put(`/me/quick-notes/${note.id}`).send({ entity_type: "budget", entity_id: 1 });

    expect(res.status).toBe(400);
    const row = await db.QuickNote.findByPk(note.id);
    expect(row.entity_type).toBeNull();
  });

  it("acepta entity_type y entity_id en null (el \"sin vínculo\" explícito)", async () => {
    const actor = await createActor();

    const res = await as(actor).post("/me/quick-notes").send({ content: "x", entity_type: null, entity_id: null });

    expect(res.status).toBe(201);
  });
});

describe("GET /me/quick-notes", () => {
  it("separa pendientes y completadas", async () => {
    const actor = await createActor();
    const pending = await createNote(actor, { content: "Pendiente" });
    const done = await createNote(actor, { content: "Hecha" });
    await as(actor).put(`/me/quick-notes/${done.id}`).send({ completed: true });

    const res = await as(actor).get("/me/quick-notes");

    expect(res.status).toBe(200);
    expect(res.body.pending.map((n) => n.id)).toEqual([pending.id]);
    expect(res.body.completed.map((n) => n.id)).toEqual([done.id]);
  });

  it("ordena los pendientes: primero con vencimiento (el más próximo arriba), después los sueltos del más nuevo al más viejo", async () => {
    const actor = await createActor();
    // Se crean directo en la base con created_at explícito: por la API quedarían en el mismo
    // segundo y el orden de las sueltas dependería del reloj.
    const [looseOld, dueLate, looseNew, dueSoon] = await Promise.all([
      db.QuickNote.create({ user_id: actor.user.id, content: "Suelta vieja", createdAt: new Date("2026-11-01T10:00:00Z") }),
      db.QuickNote.create({ user_id: actor.user.id, content: "Vence tarde", due_date: "2026-12-30" }),
      db.QuickNote.create({ user_id: actor.user.id, content: "Suelta nueva", createdAt: new Date("2026-11-02T10:00:00Z") }),
      db.QuickNote.create({ user_id: actor.user.id, content: "Vence pronto", due_date: "2026-11-10" }),
    ]);

    const res = await as(actor).get("/me/quick-notes");

    expect(res.body.pending.map((n) => n.id)).toEqual([dueSoon.id, dueLate.id, looseNew.id, looseOld.id]);
  });

  it("limita las completadas a las últimas 50, la más reciente primero", async () => {
    const actor = await createActor();
    const rows = [];
    for (let i = 0; i < 52; i += 1) {
      rows.push({
        user_id: actor.user.id,
        content: `Nota ${i}`,
        completed_at: new Date(Date.UTC(2026, 9, 1, 0, i)),
      });
    }
    await db.QuickNote.bulkCreate(rows);

    const res = await as(actor).get("/me/quick-notes");

    expect(res.body.completed).toHaveLength(50);
    expect(res.body.completed[0].content).toBe("Nota 51");
    expect(res.body.completed[49].content).toBe("Nota 2");
  });

  it("no incluye las notas eliminadas", async () => {
    const actor = await createActor();
    const note = await createNote(actor);
    await as(actor).delete(`/me/quick-notes/${note.id}`);

    const res = await as(actor).get("/me/quick-notes");

    expect(res.body.pending).toEqual([]);
    expect(res.body.completed).toEqual([]);
  });

  it("no mezcla las notas de dos usuarios", async () => {
    const a = await createActor();
    const b = await createActor();
    const noteA = await createNote(a, { content: "De A" });
    const noteB = await createNote(b, { content: "De B" });

    const resA = await as(a).get("/me/quick-notes");
    const resB = await as(b).get("/me/quick-notes");

    expect(resA.body.pending.map((n) => n.id)).toEqual([noteA.id]);
    expect(resB.body.pending.map((n) => n.id)).toEqual([noteB.id]);
  });
});

describe("PUT /me/quick-notes/:id", () => {
  it("edita el texto", async () => {
    const actor = await createActor();
    const note = await createNote(actor);

    const res = await as(actor).put(`/me/quick-notes/${note.id}`).send({ content: "Texto nuevo" });

    expect(res.status).toBe(200);
    expect(res.body.data.content).toBe("Texto nuevo");
  });

  it("cambia y quita el vencimiento (null y '' lo limpian)", async () => {
    const actor = await createActor();
    const note = await createNote(actor, { due_date: "2026-11-10" });

    const changed = await as(actor).put(`/me/quick-notes/${note.id}`).send({ due_date: "2026-11-20" });
    const cleared = await as(actor).put(`/me/quick-notes/${note.id}`).send({ due_date: null });
    await as(actor).put(`/me/quick-notes/${note.id}`).send({ due_date: "2026-11-25" });
    const clearedWithBlank = await as(actor).put(`/me/quick-notes/${note.id}`).send({ due_date: "" });

    expect(changed.body.data.due_date).toBe("2026-11-20");
    expect(cleared.body.data.due_date).toBeNull();
    expect(clearedWithBlank.body.data.due_date).toBeNull();
  });

  it("completa la nota y la reabre", async () => {
    const actor = await createActor();
    const note = await createNote(actor);

    const done = await as(actor).put(`/me/quick-notes/${note.id}`).send({ completed: true });
    const reopened = await as(actor).put(`/me/quick-notes/${note.id}`).send({ completed: false });

    expect(done.status).toBe(200);
    expect(done.body.data.completed_at).not.toBeNull();
    expect(reopened.body.data.completed_at).toBeNull();
  });

  it("completar una nota ya completada no pisa la fecha original", async () => {
    const actor = await createActor();
    const note = await createNote(actor);
    const original = new Date("2026-10-01T12:00:00Z");
    await db.QuickNote.update({ completed_at: original }, { where: { id: note.id } });

    const res = await as(actor).put(`/me/quick-notes/${note.id}`).send({ completed: true });

    expect(res.status).toBe(200);
    expect(new Date(res.body.data.completed_at).getTime()).toBe(original.getTime());
  });

  it("rechaza con 400 un completed que no es booleano", async () => {
    const actor = await createActor();
    const note = await createNote(actor);

    const res = await as(actor).put(`/me/quick-notes/${note.id}`).send({ completed: "true" });

    expect(res.status).toBe(400);
  });

  it("rechaza con 400 un texto vacío o un body sin cambios", async () => {
    const actor = await createActor();
    const note = await createNote(actor);

    const empty = await as(actor).put(`/me/quick-notes/${note.id}`).send({ content: "  " });
    const nothing = await as(actor).put(`/me/quick-notes/${note.id}`).send({});

    expect(empty.status).toBe(400);
    expect(nothing.status).toBe(400);
  });

  it("no deja cambiar el dueño de la nota por el body", async () => {
    const actor = await createActor();
    const other = await createActor();
    const note = await createNote(actor);

    await as(actor).put(`/me/quick-notes/${note.id}`).send({ content: "x", user_id: other.user.id });

    const row = await db.QuickNote.findByPk(note.id);
    expect(row.user_id).toBe(actor.user.id);
  });

  it("responde 404 si la nota es de otro usuario y no la modifica", async () => {
    const owner = await createActor();
    const intruder = await createActor();
    const note = await createNote(owner, { content: "Privada" });

    const res = await as(intruder).put(`/me/quick-notes/${note.id}`).send({ content: "Pisada", completed: true });

    expect(res.status).toBe(404);
    const row = await db.QuickNote.findByPk(note.id);
    expect(row.content).toBe("Privada");
    expect(row.completed_at).toBeNull();
  });

  it("responde 404 si la nota no existe o está eliminada, y 400 si el id no es un número", async () => {
    const actor = await createActor();
    const note = await createNote(actor);
    await as(actor).delete(`/me/quick-notes/${note.id}`);

    const missing = await as(actor).put("/me/quick-notes/999999").send({ content: "x" });
    const deleted = await as(actor).put(`/me/quick-notes/${note.id}`).send({ content: "x" });
    const badId = await as(actor).put("/me/quick-notes/abc").send({ content: "x" });

    expect(missing.status).toBe(404);
    expect(deleted.status).toBe(404);
    expect(badId.status).toBe(400);
  });
});

describe("DELETE /me/quick-notes/:id y POST /me/quick-notes/:id/restore", () => {
  it("elimina la nota sin borrar la fila (soft delete)", async () => {
    const actor = await createActor();
    const note = await createNote(actor);

    const res = await as(actor).delete(`/me/quick-notes/${note.id}`);

    expect(res.status).toBe(200);
    expect(await db.QuickNote.findByPk(note.id)).toBeNull();
    expect(await db.QuickNote.findByPk(note.id, { paranoid: false })).not.toBeNull();
  });

  it("restaura una nota eliminada (el \"Deshacer\") y vuelve a aparecer en el listado", async () => {
    const actor = await createActor();
    const note = await createNote(actor, { content: "Volvé" });
    await as(actor).delete(`/me/quick-notes/${note.id}`);

    const res = await as(actor).post(`/me/quick-notes/${note.id}/restore`);

    expect(res.status).toBe(200);
    expect(res.body.data.content).toBe("Volvé");
    const list = await as(actor).get("/me/quick-notes");
    expect(list.body.pending.map((n) => n.id)).toEqual([note.id]);
  });

  it("restaurar una nota que no estaba eliminada la devuelve tal cual", async () => {
    const actor = await createActor();
    const note = await createNote(actor);

    const res = await as(actor).post(`/me/quick-notes/${note.id}/restore`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(note.id);
  });

  it("conserva el estado de completada al eliminar y restaurar", async () => {
    const actor = await createActor();
    const note = await createNote(actor);
    await as(actor).put(`/me/quick-notes/${note.id}`).send({ completed: true });
    await as(actor).delete(`/me/quick-notes/${note.id}`);

    const res = await as(actor).post(`/me/quick-notes/${note.id}/restore`);

    expect(res.body.data.completed_at).not.toBeNull();
  });

  it("responde 404 al eliminar o restaurar una nota de otro usuario, y no la toca", async () => {
    const owner = await createActor();
    const intruder = await createActor();
    const note = await createNote(owner);

    const del = await as(intruder).delete(`/me/quick-notes/${note.id}`);
    expect(del.status).toBe(404);
    expect(await db.QuickNote.findByPk(note.id)).not.toBeNull();

    // Y tampoco puede "restaurar" una que el dueño eliminó.
    await as(owner).delete(`/me/quick-notes/${note.id}`);
    const restore = await as(intruder).post(`/me/quick-notes/${note.id}/restore`);
    expect(restore.status).toBe(404);
    expect(await db.QuickNote.findByPk(note.id)).toBeNull();
  });

  it("responde 404 si la nota no existe y 400 si el id no es un número", async () => {
    const actor = await createActor();

    expect((await as(actor).delete("/me/quick-notes/999999")).status).toBe(404);
    expect((await as(actor).post("/me/quick-notes/999999/restore")).status).toBe(404);
    expect((await as(actor).delete("/me/quick-notes/abc")).status).toBe(400);
    expect((await as(actor).post("/me/quick-notes/abc/restore")).status).toBe(400);
  });
});
