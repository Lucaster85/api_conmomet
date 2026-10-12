"use strict";
// Campanita de notificaciones (ver FLOWS.md §37). Como las rutas viven en /me/* sin
// authPermission, lo que hay que cubrir no es una matriz de permisos sino el aislamiento entre
// usuarios, la paginación por cursor y que `notify()` persista lo mismo que manda por push.
const db = require("../../models");
const { createActor, as, request, app } = require("../helpers/auth");
const { notify, pruneOldNotifications } = require("../../helpers/notificationService");
const { createClient } = require("../factories/budget");

async function seedNotifications(userId, count, overrides = {}) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      user_id: userId,
      type: "quote_request_assigned",
      title: `Notificación ${i + 1}`,
      body: `Cuerpo ${i + 1}`,
      url: "/dashboard/quote-requests",
      entity_type: "quote_request",
      entity_id: i + 1,
      ...overrides,
    });
  }
  return db.Notification.bulkCreate(rows);
}

describe("helpers/notificationService#notify", () => {
  it("persiste una fila por destinatario", async () => {
    const a = await createActor();
    const b = await createActor();
    const actor = await createActor();

    await notify([a.user.id, b.user.id], {
      type: "quote_request_assigned",
      title: "Nuevo Pedido de Cotización",
      body: "PC-001: revisalo",
      url: "/dashboard/quote-requests?view=1",
      entity: { type: "quote_request", id: 1 },
      excludeUserId: actor.user.id,
    });

    expect(await db.Notification.count()).toBe(2);
    const fila = await db.Notification.findOne({ where: { user_id: a.user.id } });
    expect(fila.title).toBe("Nuevo Pedido de Cotización");
    expect(fila.entity_type).toBe("quote_request");
    expect(fila.entity_id).toBe(1);
    expect(fila.read_at).toBeNull();
    // created_by queda en el actor excluido: es quien generó el aviso.
    expect(fila.created_by).toBe(actor.user.id);
  });

  // Si no excluyera al actor, la campanita le sonaría a quien acaba de hacer la acción.
  it("no se auto-notifica al actor aunque esté en la lista de destinatarios", async () => {
    const actor = await createActor();
    const otro = await createActor();

    await notify([actor.user.id, otro.user.id], {
      type: "quote_request_assigned",
      title: "Nuevo Pedido de Cotización",
      excludeUserId: actor.user.id,
    });

    expect(await db.Notification.count({ where: { user_id: actor.user.id } })).toBe(0);
    expect(await db.Notification.count({ where: { user_id: otro.user.id } })).toBe(1);
  });

  it("deduplica destinatarios repetidos", async () => {
    const a = await createActor();
    await notify([a.user.id, a.user.id, a.user.id], {
      type: "quote_request_assigned",
      title: "Nuevo Pedido de Cotización",
    });
    expect(await db.Notification.count()).toBe(1);
  });

  it("sin destinatarios tras excluir al actor, no persiste nada", async () => {
    const actor = await createActor();
    await notify([actor.user.id], { type: "quote_request_assigned", title: "X", excludeUserId: actor.user.id });
    expect(await db.Notification.count()).toBe(0);
  });

  // Es la ventaja concreta de persistir: el push corta el cuerpo en 150 chars, la campanita no.
  it("guarda el cuerpo completo aunque supere el tope del push", async () => {
    const a = await createActor();
    const largo = "x".repeat(400);
    await notify([a.user.id], { type: "quote_request_returned", title: "Presupuesto devuelto", body: largo });
    const fila = await db.Notification.findOne({ where: { user_id: a.user.id } });
    expect(fila.body).toHaveLength(400);
  });

  // notify() nunca puede romper la operación de negocio que la llamó (mismo contrato que
  // sendPushToUsers): un tipo inválido se loguea y sigue, no lanza.
  it("no lanza con un tipo desconocido y persiste igual", async () => {
    const a = await createActor();
    await expect(
      notify([a.user.id], { type: "tipo_que_no_existe", title: "Algo pasó" })
    ).resolves.toBeDefined();
    expect(await db.Notification.count()).toBe(1);
  });

  it("no lanza si se la llama sin destinatarios ni opciones", async () => {
    await expect(notify()).resolves.toBeDefined();
    await expect(notify([], {})).resolves.toBeDefined();
    expect(await db.Notification.count()).toBe(0);
  });
});

describe("GET /me/notifications", () => {
  it("devuelve solo las del usuario autenticado, más nuevas primero", async () => {
    const actor = await createActor();
    const otro = await createActor();
    await seedNotifications(actor.user.id, 3);
    await seedNotifications(otro.user.id, 2);

    const res = await as(actor).get("/me/notifications");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.data[0].title).toBe("Notificación 3");
    expect(res.body.unread_count).toBe(3);
    expect(res.body.has_more).toBe(false);
  });

  it("pagina por cursor sin repetir filas", async () => {
    const actor = await createActor();
    await seedNotifications(actor.user.id, 25);

    const primera = await as(actor).get("/me/notifications?limit=10");
    expect(primera.body.data).toHaveLength(10);
    expect(primera.body.has_more).toBe(true);
    expect(primera.body.unread_count).toBe(25);

    const segunda = await as(actor).get(`/me/notifications?limit=10&before=${primera.body.next_cursor}`);
    expect(segunda.body.data).toHaveLength(10);

    const idsPrimera = primera.body.data.map((n) => n.id);
    const idsSegunda = segunda.body.data.map((n) => n.id);
    expect(idsSegunda.some((id) => idsPrimera.includes(id))).toBe(false);
  });

  it("filtra por no leídas con unread_only, pero el contador sigue siendo el total", async () => {
    const actor = await createActor();
    await seedNotifications(actor.user.id, 2);
    await seedNotifications(actor.user.id, 3, { read_at: new Date() });

    const res = await as(actor).get("/me/notifications?unread_only=true");
    expect(res.body.data).toHaveLength(2);
    expect(res.body.unread_count).toBe(2);
  });

  it("400 con un cursor no numérico", async () => {
    const actor = await createActor();
    const res = await as(actor).get("/me/notifications?before=abc");
    expect(res.status).toBe(400);
  });

  it("401 sin token", async () => {
    const res = await request(app).get("/me/notifications");
    expect(res.status).toBe(401);
  });
});

describe("GET /me/notifications/unread-count", () => {
  it("cuenta solo las no leídas del usuario autenticado", async () => {
    const actor = await createActor();
    const otro = await createActor();
    await seedNotifications(actor.user.id, 4);
    await seedNotifications(actor.user.id, 2, { read_at: new Date() });
    await seedNotifications(otro.user.id, 7);

    const res = await as(actor).get("/me/notifications/unread-count");
    expect(res.status).toBe(200);
    expect(res.body.data.unread_count).toBe(4);
  });
});

describe("POST /me/notifications/:id/read", () => {
  it("marca leída y devuelve el contador actualizado", async () => {
    const actor = await createActor();
    const [n] = await seedNotifications(actor.user.id, 3);

    const res = await as(actor).post(`/me/notifications/${n.id}/read`);
    expect(res.status).toBe(200);
    expect(res.body.data.unread_count).toBe(2);

    await n.reload();
    expect(n.read_at).not.toBeNull();
  });

  it("es idempotente: marcar dos veces no es un error", async () => {
    const actor = await createActor();
    const [n] = await seedNotifications(actor.user.id, 1);

    await as(actor).post(`/me/notifications/${n.id}/read`);
    const res = await as(actor).post(`/me/notifications/${n.id}/read`);
    expect(res.status).toBe(200);
    expect(res.body.data.unread_count).toBe(0);
  });

  // Lo importante: la notificación de otro no se toca Y no se filtra que existe.
  it("404 con una notificación de otro usuario, y no la marca", async () => {
    const actor = await createActor();
    const otro = await createActor();
    const [ajena] = await seedNotifications(otro.user.id, 1);

    const res = await as(actor).post(`/me/notifications/${ajena.id}/read`);
    expect(res.status).toBe(404);

    await ajena.reload();
    expect(ajena.read_at).toBeNull();
  });

  it("404 con un id inexistente", async () => {
    const actor = await createActor();
    const res = await as(actor).post("/me/notifications/999999/read");
    expect(res.status).toBe(404);
  });
});

describe("POST /me/notifications/read-all", () => {
  it("marca todas las propias y ninguna ajena", async () => {
    const actor = await createActor();
    const otro = await createActor();
    await seedNotifications(actor.user.id, 5);
    await seedNotifications(otro.user.id, 3);

    const res = await as(actor).post("/me/notifications/read-all");
    expect(res.status).toBe(200);
    expect(res.body.data.marked).toBe(5);
    expect(res.body.data.unread_count).toBe(0);

    expect(await db.Notification.count({ where: { user_id: actor.user.id, read_at: null } })).toBe(0);
    expect(await db.Notification.count({ where: { user_id: otro.user.id, read_at: null } })).toBe(3);
  });
});

// Integración real controller → notify → feed. Lo que prueba y ningún test unitario cubre: que un
// disparador de negocio efectivamente deje la notificación consultable, incluso cuando el push no
// se manda (en el entorno de test no hay ninguna suscripción) — que es justamente el caso que
// antes de este flujo perdía el aviso por completo.
describe("end-to-end: crear un PC deja la notificación en la campanita del asignado", () => {
  it("el responsable la ve con el comentario; el creador no se auto-notifica", async () => {
    const gerente = await createActor({ role: "admin" });
    const responsable = await createActor({ permissions: ["quote_requests_read"] });
    const cliente = await createClient();

    const res = await as(gerente).post("/quote-requests").send({
      title: "Tanque E2E",
      client_id: cliente.id,
      due_date: "2026-12-31",
      client_quote_number: "COT-E2E-001",
      assignee_ids: [responsable.user.id],
      comment: "revisalo esta semana",
    });
    expect(res.status).toBe(201);

    // notify() es fire-and-forget: el controller no la espera, así que se le da una vuelta de
    // event loop antes de consultar.
    await new Promise((r) => setTimeout(r, 150));

    const feed = await as(responsable).get("/me/notifications");
    expect(feed.status).toBe(200);
    expect(feed.body.unread_count).toBe(1);
    expect(feed.body.data[0].title).toBe("Nuevo Pedido de Cotización");
    expect(feed.body.data[0].body).toContain("revisalo esta semana");
    expect(feed.body.data[0].type).toBe("quote_request_assigned");
    expect(feed.body.data[0].entity_type).toBe("quote_request");
    expect(feed.body.data[0].url).toContain("/dashboard/quote-requests?view=");
    // created_at parseable: `underscored: true` deja el atributo del modelo en `createdAt`, así
    // que sin la normalización del controller el frontend recibía undefined y renderizaba
    // "Invalid Date" en la campanita. Este assert es el que faltaba y dejó pasar el bug.
    expect(feed.body.data[0].created_at).toBeTruthy();
    expect(Number.isNaN(new Date(feed.body.data[0].created_at).getTime())).toBe(false);

    const feedGerente = await as(gerente).get("/me/notifications");
    expect(feedGerente.body.unread_count).toBe(0);

    const marcada = await as(responsable).post(`/me/notifications/${feed.body.data[0].id}/read`);
    expect(marcada.body.data.unread_count).toBe(0);
  });
});

describe("GET /me/notifications — forma del payload que consume el frontend", () => {
  it("devuelve created_at parseable en todas las filas, no solo createdAt", async () => {
    const actor = await createActor();
    await seedNotifications(actor.user.id, 3);

    const res = await as(actor).get("/me/notifications");
    expect(res.status).toBe(200);
    for (const n of res.body.data) {
      expect(n.created_at).toBeTruthy();
      expect(Number.isNaN(new Date(n.created_at).getTime())).toBe(false);
    }
  });

  // La poda filtra por `created_at` en el where. Funciona porque Sequelize lo resuelve contra la
  // columna real, pero es justo el tipo de cosa que se rompe en silencio al tocar el modelo: sin
  // poda, la tabla crece sin techo y nadie se entera.
  it("poda las de más de 90 días y conserva las recientes", async () => {
    const actor = await createActor();
    const vieja = await db.Notification.create({
      user_id: actor.user.id, type: "budget_sent", title: "Vieja",
    });
    await db.Notification.create({
      user_id: actor.user.id, type: "budget_sent", title: "Nueva",
    });
    // Por SQL directo: Sequelize ignora createdAt en create().
    await db.sequelize.query(
      "UPDATE Notifications SET created_at = DATE_SUB(NOW(), INTERVAL 120 DAY) WHERE id = :id",
      { replacements: { id: vieja.id } }
    );

    await pruneOldNotifications(actor.user.id);

    const quedan = await db.Notification.findAll({ where: { user_id: actor.user.id } });
    expect(quedan).toHaveLength(1);
    expect(quedan[0].title).toBe("Nueva");
  });
});
