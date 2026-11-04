"use strict";
// Aviso al vencer de las notas rápidas (ver FLOWS.md §48, etapa 3): el paso `syncQuickNotes` del
// barrido de services/expirationNotifier.js y las reglas del controller sobre `due_notified_at`.
//
// "Hoy" sale de helpers/argentinaDate.js, igual que en el código de producción: NO de
// toISOString(), que a partir de las 21 hs de Argentina ya da el día siguiente y haría que estos
// tests fallaran según la hora a la que se corran.
const db = require("../../models");
const { createActor, as } = require("../helpers/auth");
const { syncExpirationNotifications } = require("../../services/expirationNotifier");
const { todayInArgentina } = require("../../helpers/argentinaDate");

async function resetThrottle() {
  await db.SystemSetting.update({ last_expiration_sync_at: null }, { where: { id: 1 } });
}

function addDays(dateKey, days) {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const today = () => todayInArgentina();
const yesterday = () => addDays(today(), -1);
const tomorrow = () => addDays(today(), 1);

// Crea la nota directo en la base (due_notified_at null), como quedaría la que se cargó sin que el
// barrido haya pasado todavía — por la API, una nota con vencimiento de hoy o pasado nace ya "avisada".
async function createNote(actor, overrides = {}) {
  return db.QuickNote.create({
    user_id: actor.user.id,
    content: "Llamar al proveedor",
    ...overrides,
  });
}

const notificationsOf = (actor) =>
  db.Notification.findAll({ where: { user_id: actor.user.id, type: "quick_note_due" }, order: [["id", "ASC"]] });

beforeEach(resetThrottle);

describe("syncExpirationNotifications — notas rápidas vencidas", () => {
  it("avisa una nota vencida a su dueño", async () => {
    const owner = await createActor();
    const note = await createNote(owner, { due_date: yesterday() });

    const summary = await syncExpirationNotifications({ force: true });

    expect(summary.quickNotes).toBe(1);
    const [n] = await notificationsOf(owner);
    expect(n.title).toBe("Nota vencida");
    expect(n.body).toBe("Llamar al proveedor");
    expect(n.entity_type).toBe("quick_note");
    expect(n.entity_id).toBe(note.id);
    expect(n.url).toBe("/dashboard");
  });

  it("avisa una nota que vence hoy como \"Nota para hoy\"", async () => {
    const owner = await createActor();
    await createNote(owner, { due_date: today() });

    await syncExpirationNotifications({ force: true });

    const [n] = await notificationsOf(owner);
    expect(n.title).toBe("Nota para hoy");
  });

  it("deja marcada la nota como avisada", async () => {
    const owner = await createActor();
    const note = await createNote(owner, { due_date: yesterday() });

    await syncExpirationNotifications({ force: true });

    await note.reload();
    expect(note.due_notified_at).not.toBeNull();
  });

  it("avisa solo al dueño de la nota", async () => {
    const owner = await createActor();
    const other = await createActor();
    await createNote(owner, { due_date: yesterday() });

    await syncExpirationNotifications({ force: true });

    expect(await notificationsOf(owner)).toHaveLength(1);
    expect(await notificationsOf(other)).toHaveLength(0);
  });

  it("no avisa a un usuario sin ningún permiso: las notas no dependen de roles", async () => {
    const owner = await createActor({ permissions: [] });
    await createNote(owner, { due_date: yesterday() });

    await syncExpirationNotifications({ force: true });

    expect(await notificationsOf(owner)).toHaveLength(1);
  });

  it("una nota ya avisada no vuelve a avisar en barridos siguientes", async () => {
    const owner = await createActor();
    await createNote(owner, { due_date: yesterday() });

    await syncExpirationNotifications({ force: true });
    const segunda = await syncExpirationNotifications({ force: true });

    expect(segunda.quickNotes).toBe(0);
    expect(await notificationsOf(owner)).toHaveLength(1);
  });

  it("dos barridos en paralelo no duplican el aviso (claim atómico)", async () => {
    const owner = await createActor();
    await createNote(owner, { due_date: yesterday() });

    // `force` se salta el CAS del throttle a propósito: lo que se prueba acá es el claim de la propia nota.
    await Promise.all([
      syncExpirationNotifications({ force: true }),
      syncExpirationNotifications({ force: true }),
    ]);

    expect(await notificationsOf(owner)).toHaveLength(1);
  });

  it("no avisa notas completadas, eliminadas, futuras ni sin vencimiento", async () => {
    const owner = await createActor();
    await createNote(owner, { due_date: yesterday(), completed_at: new Date() });
    const deleted = await createNote(owner, { due_date: yesterday() });
    await deleted.destroy();
    await createNote(owner, { due_date: tomorrow() });
    await createNote(owner, { due_date: null });

    const summary = await syncExpirationNotifications({ force: true });

    expect(summary.quickNotes).toBe(0);
    expect(await notificationsOf(owner)).toHaveLength(0);
  });

  it("recorta a una línea el texto de una nota larga o con saltos de línea", async () => {
    const owner = await createActor();
    await createNote(owner, { due_date: yesterday(), content: `Primera línea\n\n  segunda línea ${"x".repeat(300)}` });

    await syncExpirationNotifications({ force: true });

    const [n] = await notificationsOf(owner);
    expect(n.body).not.toMatch(/\n/);
    expect(n.body.startsWith("Primera línea segunda línea")).toBe(true);
    expect(n.body.length).toBeLessThanOrEqual(120);
    expect(n.body.endsWith("…")).toBe(true);
  });

  it("el barrido respeta el throttle: la segunda corrida seguida no avisa notas nuevas hasta pasar la hora", async () => {
    const owner = await createActor();
    await createNote(owner, { due_date: yesterday() });

    const primera = await syncExpirationNotifications();
    await createNote(owner, { due_date: yesterday(), content: "Otra" });
    const segunda = await syncExpirationNotifications();

    expect(primera.ran).toBe(true);
    expect(segunda.ran).toBe(false);
    expect(await notificationsOf(owner)).toHaveLength(1);
  });
});

describe("due_notified_at en el controller", () => {
  it("una nota creada con vencimiento de hoy nace como ya avisada: no avisa en el próximo barrido", async () => {
    const owner = await createActor();

    const res = await as(owner).post("/me/quick-notes").send({ content: "Para hoy", due_date: today() });
    const summary = await syncExpirationNotifications({ force: true });

    expect(res.status).toBe(201);
    expect((await db.QuickNote.findByPk(res.body.data.id)).due_notified_at).not.toBeNull();
    expect(summary.quickNotes).toBe(0);
    expect(await notificationsOf(owner)).toHaveLength(0);
  });

  it("una nota creada con un vencimiento ya pasado tampoco avisa", async () => {
    const owner = await createActor();

    await as(owner).post("/me/quick-notes").send({ content: "Atrasada", due_date: yesterday() });
    await syncExpirationNotifications({ force: true });

    expect(await notificationsOf(owner)).toHaveLength(0);
  });

  it("una nota con vencimiento futuro o sin vencimiento nace sin avisar", async () => {
    const owner = await createActor();

    const future = await as(owner).post("/me/quick-notes").send({ content: "Futura", due_date: tomorrow() });
    const none = await as(owner).post("/me/quick-notes").send({ content: "Suelta" });

    expect((await db.QuickNote.findByPk(future.body.data.id)).due_notified_at).toBeNull();
    expect((await db.QuickNote.findByPk(none.body.data.id)).due_notified_at).toBeNull();
  });

  it("cambiar el vencimiento a una fecha futura reinicia la marca: la nota puede avisar de nuevo", async () => {
    const owner = await createActor();
    const note = await createNote(owner, { due_date: yesterday() });
    await syncExpirationNotifications({ force: true });
    expect(await notificationsOf(owner)).toHaveLength(1);

    const res = await as(owner).put(`/me/quick-notes/${note.id}`).send({ due_date: tomorrow() });
    expect(res.status).toBe(200);
    expect((await db.QuickNote.findByPk(note.id)).due_notified_at).toBeNull();

    // Pasa el tiempo: la fecha nueva llega.
    await db.QuickNote.update({ due_date: today() }, { where: { id: note.id } });
    await syncExpirationNotifications({ force: true });

    const notifications = await notificationsOf(owner);
    expect(notifications).toHaveLength(2);
    expect(notifications[1].title).toBe("Nota para hoy");
  });

  it("cambiar el vencimiento a hoy o a una fecha pasada la deja como ya avisada", async () => {
    const owner = await createActor();
    const note = await createNote(owner, { due_date: tomorrow() });

    await as(owner).put(`/me/quick-notes/${note.id}`).send({ due_date: today() });
    await syncExpirationNotifications({ force: true });

    expect((await db.QuickNote.findByPk(note.id)).due_notified_at).not.toBeNull();
    expect(await notificationsOf(owner)).toHaveLength(0);
  });

  it("quitar el vencimiento reinicia la marca", async () => {
    const owner = await createActor();
    const note = await createNote(owner, { due_date: yesterday() });
    await syncExpirationNotifications({ force: true });

    await as(owner).put(`/me/quick-notes/${note.id}`).send({ due_date: null });

    expect((await db.QuickNote.findByPk(note.id)).due_notified_at).toBeNull();
  });

  it("editar solo el texto no toca la marca", async () => {
    const owner = await createActor();
    const note = await createNote(owner, { due_date: yesterday() });
    await syncExpirationNotifications({ force: true });
    const before = (await db.QuickNote.findByPk(note.id)).due_notified_at;

    await as(owner).put(`/me/quick-notes/${note.id}`).send({ content: "Texto nuevo" });
    await syncExpirationNotifications({ force: true });

    const after = (await db.QuickNote.findByPk(note.id)).due_notified_at;
    expect(after.getTime()).toBe(before.getTime());
    expect(await notificationsOf(owner)).toHaveLength(1);
  });

  it("reabrir una nota vencida que se completó antes de avisar no dispara un aviso: la reabrió a propósito", async () => {
    const owner = await createActor();
    const note = await createNote(owner, { due_date: yesterday(), completed_at: new Date() });

    await as(owner).put(`/me/quick-notes/${note.id}`).send({ completed: false });
    await syncExpirationNotifications({ force: true });

    expect(await notificationsOf(owner)).toHaveLength(0);
  });

  it("reabrir una nota vencida que ya había avisado no vuelve a avisar", async () => {
    const owner = await createActor();
    const note = await createNote(owner, { due_date: yesterday() });
    await syncExpirationNotifications({ force: true });
    await as(owner).put(`/me/quick-notes/${note.id}`).send({ completed: true });

    await as(owner).put(`/me/quick-notes/${note.id}`).send({ completed: false });
    await syncExpirationNotifications({ force: true });

    expect(await notificationsOf(owner)).toHaveLength(1);
  });
});
