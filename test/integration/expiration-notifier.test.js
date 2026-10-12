"use strict";
// Barrido de los avisos que dependen del calendario (ver FLOWS.md §38). Lo que importa cubrir no
// es el texto de la notificación sino las tres propiedades que hacen que el mecanismo sea seguro:
// el throttle/lock (no barrer de más ni en paralelo), la idempotencia (no duplicar) y que la
// marca de "ya avisé" sea POR USUARIO (lo que `alert_status` no podía expresar).
const db = require("../../models");
const { createActor, as } = require("../helpers/auth");
const { syncExpirationNotifications } = require("../../services/expirationNotifier");

// SystemSettings no se trunca entre tests (test/setup/truncate.js), así que el timestamp del
// throttle sobrevive de un test a otro y hay que resetearlo a mano.
async function resetThrottle() {
  await db.SystemSetting.update({ last_expiration_sync_at: null }, { where: { id: 1 } });
}

function inDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

// `uploaded_by` es obligatorio en el modelo, así que el fixture necesita un usuario cargador.
// No es el destinatario del aviso: los destinatarios se resuelven por permiso.
async function createDocument(uploaderId, overrides = {}) {
  return db.EntityDocument.create({
    title: "Carnet de conducir",
    entity_type: "company",
    expiration_date: inDays(5),
    notify_days_before: 15,
    is_renewable: true,
    uploaded_by: uploaderId,
    ...overrides,
  });
}

beforeEach(resetThrottle);

describe("syncExpirationNotifications — throttle y lock (el CAS)", () => {
  it("la segunda corrida seguida no vuelve a barrer", async () => {
    const dest = await createActor({ permissions: ["documents_read"] });
    await createDocument(dest.user.id);

    const primera = await syncExpirationNotifications();
    const segunda = await syncExpirationNotifications();

    expect(primera.ran).toBe(true);
    expect(segunda.ran).toBe(false);
  });

  it("vuelve a barrer cuando pasó más de la ventana del throttle", async () => {
    const dest = await createActor({ permissions: ["documents_read"] });
    await createDocument(dest.user.id);

    await syncExpirationNotifications();
    await db.SystemSetting.update(
      { last_expiration_sync_at: new Date(Date.now() - 2 * 60 * 60 * 1000) },
      { where: { id: 1 } }
    );

    const otra = await syncExpirationNotifications();
    expect(otra.ran).toBe(true);
  });

  // Es el escenario que el CAS existe para cubrir: dos usuarios entrando a la vez. Sin el lock,
  // las dos corridas chequearían "¿ya notifiqué?" simultáneamente, las dos dirían que no, y
  // duplicarían el aviso.
  it("dos corridas en paralelo: solo una barre, y no se duplica la notificación", async () => {
    const dest = await createActor({ permissions: ["documents_read"] });
    await createDocument(dest.user.id);

    const [a, b] = await Promise.all([
      syncExpirationNotifications(),
      syncExpirationNotifications(),
    ]);

    expect([a.ran, b.ran].filter(Boolean)).toHaveLength(1);
    expect(await db.Notification.count({ where: { user_id: dest.user.id } })).toBe(1);
  });
});

describe("syncExpirationNotifications — idempotencia", () => {
  it("barrer dos veces no duplica la notificación del mismo documento", async () => {
    const dest = await createActor({ permissions: ["documents_read"] });
    await createDocument(dest.user.id);

    await syncExpirationNotifications();
    await resetThrottle();
    await syncExpirationNotifications({ force: true });

    expect(await db.Notification.count({ where: { user_id: dest.user.id } })).toBe(1);
  });

  // La marca es por usuario, no global por documento: si fuera `alert_status`, el segundo usuario
  // nunca se enteraría de un vencimiento que ya se había avisado antes de que tuviera permiso.
  it("un usuario que recibe el permiso DESPUÉS recibe el aviso en el barrido siguiente", async () => {
    const primero = await createActor({ permissions: ["documents_read"] });
    await createDocument(primero.user.id);

    await syncExpirationNotifications();
    expect(await db.Notification.count({ where: { user_id: primero.user.id } })).toBe(1);

    // Llega alguien nuevo con el permiso, el documento sigue por vencer.
    const segundo = await createActor({ permissions: ["documents_read"] });
    await syncExpirationNotifications({ force: true });

    expect(await db.Notification.count({ where: { user_id: segundo.user.id } })).toBe(1);
    // Y el primero NO recibe una segunda copia.
    expect(await db.Notification.count({ where: { user_id: primero.user.id } })).toBe(1);
  });

  // "Por vencer" y "vencido" son tipos distintos justamente para esto: pasar de uno a otro es
  // una novedad real y tiene que volver a avisar.
  it("un documento que pasa de por-vencer a vencido genera una notificación nueva", async () => {
    const dest = await createActor({ permissions: ["documents_read"] });
    const doc = await createDocument(dest.user.id, { expiration_date: inDays(5) });

    await syncExpirationNotifications();
    const primera = await db.Notification.findAll({ where: { user_id: dest.user.id } });
    expect(primera).toHaveLength(1);
    expect(primera[0].type).toBe("document_expiring");

    await doc.update({ expiration_date: inDays(-1) });
    await syncExpirationNotifications({ force: true });

    const tipos = (await db.Notification.findAll({ where: { user_id: dest.user.id } })).map((n) => n.type);
    expect(tipos).toHaveLength(2);
    expect(tipos).toContain("document_expired");
  });
});

describe("syncExpirationNotifications — destinatarios y alcance", () => {
  it("solo notifica a quien tiene el permiso del aviso", async () => {
    const conPermiso = await createActor({ permissions: ["documents_read"] });
    const sinPermiso = await createActor();
    await createDocument(conPermiso.user.id);

    await syncExpirationNotifications();

    expect(await db.Notification.count({ where: { user_id: conPermiso.user.id } })).toBe(1);
    expect(await db.Notification.count({ where: { user_id: sinPermiso.user.id } })).toBe(0);
  });

  it("no notifica un documento que todavía está lejos de vencer", async () => {
    const dest = await createActor({ permissions: ["documents_read"] });
    await createDocument(dest.user.id, { expiration_date: inDays(90) });

    await syncExpirationNotifications();
    expect(await db.Notification.count({ where: { user_id: dest.user.id } })).toBe(0);
  });

  it("no notifica un documento ya resuelto", async () => {
    const dest = await createActor({ permissions: ["documents_read"] });
    await createDocument(dest.user.id, { expiration_date: inDays(-5), alert_status: "resolved" });

    await syncExpirationNotifications();
    expect(await db.Notification.count({ where: { user_id: dest.user.id } })).toBe(0);
  });

  it("no notifica un documento sin fecha de vencimiento", async () => {
    const dest = await createActor({ permissions: ["documents_read"] });
    await createDocument(dest.user.id, { expiration_date: null });

    await syncExpirationNotifications();
    expect(await db.Notification.count({ where: { user_id: dest.user.id } })).toBe(0);
  });

  it("la notificación trae created_at parseable (el bug de la etapa 2 que no hay que repetir)", async () => {
    const dest = await createActor({ permissions: ["documents_read"] });
    await createDocument(dest.user.id);
    await syncExpirationNotifications();

    const res = await as(dest).get("/me/notifications");
    expect(res.body.data).toHaveLength(1);
    expect(Number.isNaN(new Date(res.body.data[0].created_at).getTime())).toBe(false);
  });

  // Contrato heredado de notify()/sendPushToUsers: un aviso caído no puede romper nada. Se la
  // llama sin await desde un endpoint de lectura, así que una promesa rechazada sin handler
  // tumbaría el proceso.
  it("nunca lanza, incluso sin datos ni destinatarios", async () => {
    await expect(syncExpirationNotifications()).resolves.toBeDefined();
    await resetThrottle();
    await expect(syncExpirationNotifications({ force: true })).resolves.toBeDefined();
  });
});

describe("GET /me/notifications/unread-count — engancha el barrido", () => {
  it("entrar a la app genera las notificaciones de vencimientos pendientes", async () => {
    const dest = await createActor({ permissions: ["documents_read"] });
    await createDocument(dest.user.id);

    // El endpoint llama al barrido sin await, así que se le da una vuelta de event loop.
    const res = await as(dest).get("/me/notifications/unread-count");
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 300));

    expect(await db.Notification.count({ where: { user_id: dest.user.id } })).toBe(1);
  });
});
