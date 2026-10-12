"use strict";
// Acuse de vista de los avisos del tablero (ver FLOWS.md §36). Las rutas viven en /me/*, sin
// authPermission: no hay matriz de permisos que ejercitar, la única barrera real es que cada
// usuario solo pueda leer y tocar sus propias filas — así que eso es lo que se cubre acá, junto
// con el upsert (re-marcar actualiza, no duplica) y la validación de la lista blanca.
const db = require("../../models");
const { createActor, as } = require("../helpers/auth");

describe("POST /me/alert-views", () => {
  it("crea la fila de vista con la revisión enviada", async () => {
    const actor = await createActor();

    const res = await as(actor).post("/me/alert-views").send({
      alert_type: "quote_request",
      items: [{ entity_id: 7, revision: "pending|0" }],
    });

    expect(res.status).toBe(200);
    expect(res.body.data.marked).toBe(1);

    const rows = await db.UserAlertView.findAll({ where: { user_id: actor.user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].alert_type).toBe("quote_request");
    expect(rows[0].entity_id).toBe(7);
    expect(rows[0].revision).toBe("pending|0");
  });

  it("re-marcar el mismo item con otra revisión actualiza la fila en vez de duplicarla", async () => {
    const actor = await createActor();

    await as(actor).post("/me/alert-views").send({
      alert_type: "quote_request",
      items: [{ entity_id: 7, revision: "pending|0" }],
    });
    await as(actor).post("/me/alert-views").send({
      alert_type: "quote_request",
      items: [{ entity_id: 7, revision: "in_progress|12" }],
    });

    const rows = await db.UserAlertView.findAll({ where: { user_id: actor.user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].revision).toBe("in_progress|12");
  });

  it("marca varios items de una (el camino de \"marcar todos como vistos\")", async () => {
    const actor = await createActor();

    const res = await as(actor).post("/me/alert-views").send({
      alert_type: "entity_document",
      items: [
        { entity_id: 1, revision: "expired|2026-01-01" },
        { entity_id: 2, revision: "expiring_soon|2026-02-01" },
        { entity_id: 3, revision: "expired|2026-03-01" },
      ],
    });

    expect(res.status).toBe(200);
    expect(res.body.data.marked).toBe(3);
    expect(await db.UserAlertView.count({ where: { user_id: actor.user.id } })).toBe(3);
  });

  it("400 con un alert_type fuera de la lista blanca, y no escribe nada", async () => {
    const actor = await createActor();

    const res = await as(actor).post("/me/alert-views").send({
      alert_type: "cualquier_cosa",
      items: [{ entity_id: 1, revision: "x" }],
    });

    expect(res.status).toBe(400);
    expect(await db.UserAlertView.count()).toBe(0);
  });

  it("400 sin items", async () => {
    const actor = await createActor();
    const res = await as(actor).post("/me/alert-views").send({ alert_type: "quote_request", items: [] });
    expect(res.status).toBe(400);
  });

  it("400 con entity_id no numérico", async () => {
    const actor = await createActor();
    const res = await as(actor).post("/me/alert-views").send({
      alert_type: "quote_request",
      items: [{ entity_id: "no-es-un-id", revision: "x" }],
    });
    expect(res.status).toBe(400);
  });

  // La revisión es opaca para el backend pero la columna es STRING(80): si truncara en silencio,
  // la guardada nunca volvería a coincidir con la calculada y el item reaparecería para siempre.
  it("400 con una revisión más larga que la columna", async () => {
    const actor = await createActor();
    const res = await as(actor).post("/me/alert-views").send({
      alert_type: "quote_request",
      items: [{ entity_id: 1, revision: "x".repeat(81) }],
    });
    expect(res.status).toBe(400);
    expect(await db.UserAlertView.count()).toBe(0);
  });

  it("ignora un user_id puesto en el body: la fila queda a nombre del usuario del token", async () => {
    const actor = await createActor();
    const otro = await createActor();

    await as(actor).post("/me/alert-views").send({
      user_id: otro.user.id,
      alert_type: "quote_request",
      items: [{ entity_id: 5, revision: "pending|0" }],
    });

    expect(await db.UserAlertView.count({ where: { user_id: actor.user.id } })).toBe(1);
    expect(await db.UserAlertView.count({ where: { user_id: otro.user.id } })).toBe(0);
  });

  it("401 sin token", async () => {
    const { request, app } = require("../helpers/auth");
    const res = await request(app).post("/me/alert-views").send({
      alert_type: "quote_request",
      items: [{ entity_id: 1, revision: "x" }],
    });
    expect(res.status).toBe(401);
  });
});

describe("GET /me/alert-views", () => {
  it("devuelve solo las vistas del usuario autenticado", async () => {
    const actor = await createActor();
    const otro = await createActor();

    await as(actor).post("/me/alert-views").send({
      alert_type: "quote_request",
      items: [{ entity_id: 1, revision: "a" }],
    });
    await as(otro).post("/me/alert-views").send({
      alert_type: "quote_request",
      items: [{ entity_id: 2, revision: "b" }],
    });

    const res = await as(actor).get("/me/alert-views");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].entity_id).toBe(1);
  });

  it("filtra por alert_type", async () => {
    const actor = await createActor();

    await as(actor).post("/me/alert-views").send({
      alert_type: "quote_request",
      items: [{ entity_id: 1, revision: "a" }],
    });
    await as(actor).post("/me/alert-views").send({
      alert_type: "tool_in_repair",
      items: [{ entity_id: 9, revision: "in_repair" }],
    });

    const res = await as(actor).get("/me/alert-views?alert_type=tool_in_repair");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].entity_id).toBe(9);
  });

  it("400 con un alert_type inválido en la query", async () => {
    const actor = await createActor();
    const res = await as(actor).get("/me/alert-views?alert_type=cualquier_cosa");
    expect(res.status).toBe(400);
  });
});

describe("DELETE /me/alert-views", () => {
  it("borra solo el alert_type pedido, y solo del usuario autenticado", async () => {
    const actor = await createActor();
    const otro = await createActor();

    await as(actor).post("/me/alert-views").send({
      alert_type: "quote_request",
      items: [{ entity_id: 1, revision: "a" }, { entity_id: 2, revision: "b" }],
    });
    await as(actor).post("/me/alert-views").send({
      alert_type: "tool_in_repair",
      items: [{ entity_id: 9, revision: "in_repair" }],
    });
    await as(otro).post("/me/alert-views").send({
      alert_type: "quote_request",
      items: [{ entity_id: 3, revision: "c" }],
    });

    const res = await as(actor).delete("/me/alert-views").send({ alert_type: "quote_request" });
    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe(2);

    const quedan = await db.UserAlertView.findAll({ where: { user_id: actor.user.id } });
    expect(quedan).toHaveLength(1);
    expect(quedan[0].alert_type).toBe("tool_in_repair");
    // La vista del otro usuario, del mismo alert_type, quedó intacta.
    expect(await db.UserAlertView.count({ where: { user_id: otro.user.id } })).toBe(1);
  });

  it("400 con un alert_type inválido", async () => {
    const actor = await createActor();
    const res = await as(actor).delete("/me/alert-views").send({ alert_type: "cualquier_cosa" });
    expect(res.status).toBe(400);
  });
});
