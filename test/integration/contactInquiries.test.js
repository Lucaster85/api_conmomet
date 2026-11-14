"use strict";
// Bandeja interna /contact-inquiries (ver FLOWS.md §58). Permisos derivados por authPermission del
// primer segmento de la ruta: contact_inquiries_read / _update / _delete. No hay _write.
const db = require("../../models");
const { createActor, as } = require("../helpers/auth");

let counter = 0;
async function createInquiry(overrides = {}) {
  counter += 1;
  return db.ContactInquiry.create({
    reason: "general",
    name: `Visitante ${counter}`,
    phone: "2262000000",
    message: `Mensaje ${counter}`,
    ...overrides,
  });
}

describe("GET /contact-inquiries", () => {
  it("lista las consultas más nuevas primero, con el permiso exacto", async () => {
    const actor = await createActor({ permissions: ["contact_inquiries_read"] });
    const first = await createInquiry();
    const second = await createInquiry();

    const res = await as(actor).get("/contact-inquiries");

    expect(res.status).toBe(200);
    expect(res.body.data.map((i) => i.id)).toEqual([second.id, first.id]);
  });

  it("devuelve 401 sin el permiso", async () => {
    const actor = await createActor({ permissions: ["quote_requests_read"] });
    const res = await as(actor).get("/contact-inquiries");
    expect(res.status).toBe(401);
  });

  it("deja pasar a admin_granted", async () => {
    const actor = await createActor({ role: "admin" });
    const res = await as(actor).get("/contact-inquiries");
    expect(res.status).toBe(200);
  });

  it("oculta las cerradas por defecto y las muestra con include_closed", async () => {
    const actor = await createActor({ permissions: ["contact_inquiries_read"] });
    const open = await createInquiry();
    const closed = await createInquiry({ status: "closed" });

    const hidden = await as(actor).get("/contact-inquiries");
    const shown = await as(actor).get("/contact-inquiries?include_closed=true");

    expect(hidden.body.data.map((i) => i.id)).toEqual([open.id]);
    expect(shown.body.data.map((i) => i.id).sort()).toEqual([open.id, closed.id].sort());
  });

  it("un estado explícito le gana a ocultar cerradas", async () => {
    const actor = await createActor({ permissions: ["contact_inquiries_read"] });
    await createInquiry();
    const closed = await createInquiry({ status: "closed" });

    const res = await as(actor).get("/contact-inquiries?status=closed");

    expect(res.body.data.map((i) => i.id)).toEqual([closed.id]);
  });

  it("filtra por motivo y busca por texto", async () => {
    const actor = await createActor({ permissions: ["contact_inquiries_read"] });
    const supplier = await createInquiry({ reason: "supplier", company: "Aceros del Plata" });
    await createInquiry({ reason: "general" });

    const byReason = await as(actor).get("/contact-inquiries?reason=supplier");
    const byText = await as(actor).get("/contact-inquiries?q=Aceros");

    expect(byReason.body.data.map((i) => i.id)).toEqual([supplier.id]);
    expect(byText.body.data.map((i) => i.id)).toEqual([supplier.id]);
  });
});

describe("GET /contact-inquiries/:id", () => {
  it("devuelve el detalle", async () => {
    const actor = await createActor({ permissions: ["contact_inquiries_read"] });
    const inquiry = await createInquiry({ email: "a@b.test" });

    const res = await as(actor).get(`/contact-inquiries/${inquiry.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe("a@b.test");
  });

  it("devuelve 404 si no existe", async () => {
    const actor = await createActor({ permissions: ["contact_inquiries_read"] });
    const res = await as(actor).get("/contact-inquiries/999999");
    expect(res.status).toBe(404);
  });

  it("devuelve 401 sin el permiso", async () => {
    const actor = await createActor();
    const inquiry = await createInquiry();
    const res = await as(actor).get(`/contact-inquiries/${inquiry.id}`);
    expect(res.status).toBe(401);
  });
});

describe("PUT /contact-inquiries/:id", () => {
  it("pasar a en curso registra quién la tomó y cuándo", async () => {
    const actor = await createActor({ permissions: ["contact_inquiries_update"] });
    const inquiry = await createInquiry();

    const res = await as(actor).put(`/contact-inquiries/${inquiry.id}`).send({ status: "in_progress" });

    expect(res.status).toBe(200);
    const row = await db.ContactInquiry.findByPk(inquiry.id);
    expect(row.status).toBe("in_progress");
    expect(row.handled_by).toBe(actor.user.id);
    expect(row.handled_at).not.toBeNull();
    expect(row.closed_by).toBeNull();
  });

  it("cerrar registra quién y cuándo", async () => {
    const actor = await createActor({ permissions: ["contact_inquiries_update"] });
    const inquiry = await createInquiry();

    await as(actor).put(`/contact-inquiries/${inquiry.id}`).send({ status: "closed" });

    const row = await db.ContactInquiry.findByPk(inquiry.id);
    expect(row.status).toBe("closed");
    expect(row.closed_by).toBe(actor.user.id);
    expect(row.closed_at).not.toBeNull();
    // Cerrarla sin haberla tomado cuenta como tomarla: no queda cerrada sin responsable.
    expect(row.handled_by).toBe(actor.user.id);
  });

  it("no pisa quién la tomó primero al cerrarla otro usuario", async () => {
    const first = await createActor({ permissions: ["contact_inquiries_update"] });
    const second = await createActor({ permissions: ["contact_inquiries_update"] });
    const inquiry = await createInquiry();

    await as(first).put(`/contact-inquiries/${inquiry.id}`).send({ status: "in_progress" });
    await as(second).put(`/contact-inquiries/${inquiry.id}`).send({ status: "closed" });

    const row = await db.ContactInquiry.findByPk(inquiry.id);
    expect(row.handled_by).toBe(first.user.id);
    expect(row.closed_by).toBe(second.user.id);
  });

  it("reabrir limpia el cierre", async () => {
    const actor = await createActor({ permissions: ["contact_inquiries_update"] });
    const inquiry = await createInquiry();
    await as(actor).put(`/contact-inquiries/${inquiry.id}`).send({ status: "closed" });

    await as(actor).put(`/contact-inquiries/${inquiry.id}`).send({ status: "in_progress" });

    const row = await db.ContactInquiry.findByPk(inquiry.id);
    expect(row.status).toBe("in_progress");
    expect(row.closed_by).toBeNull();
    expect(row.closed_at).toBeNull();
  });

  it("guarda las notas internas sin tocar lo que envió el visitante", async () => {
    const actor = await createActor({ permissions: ["contact_inquiries_update"] });
    const inquiry = await createInquiry({ message: "Original" });

    await as(actor).put(`/contact-inquiries/${inquiry.id}`).send({ internal_notes: "  Lo llamé, vuelve a llamar  ", message: "Pisado" });

    const row = await db.ContactInquiry.findByPk(inquiry.id);
    expect(row.internal_notes).toBe("Lo llamé, vuelve a llamar");
    expect(row.message).toBe("Original");
  });

  it("devuelve 400 con un estado inválido", async () => {
    const actor = await createActor({ permissions: ["contact_inquiries_update"] });
    const inquiry = await createInquiry();
    const res = await as(actor).put(`/contact-inquiries/${inquiry.id}`).send({ status: "archivada" });
    expect(res.status).toBe(400);
  });

  it("devuelve 401 con solo contact_inquiries_read", async () => {
    const actor = await createActor({ permissions: ["contact_inquiries_read"] });
    const inquiry = await createInquiry();
    const res = await as(actor).put(`/contact-inquiries/${inquiry.id}`).send({ status: "closed" });
    expect(res.status).toBe(401);
  });

  it("deja pasar a admin_granted", async () => {
    const actor = await createActor({ role: "admin" });
    const inquiry = await createInquiry();
    const res = await as(actor).put(`/contact-inquiries/${inquiry.id}`).send({ status: "closed" });
    expect(res.status).toBe(200);
  });
});

describe("DELETE /contact-inquiries/:id", () => {
  it("la borra (soft delete) con el permiso exacto", async () => {
    const actor = await createActor({ permissions: ["contact_inquiries_delete"] });
    const inquiry = await createInquiry();

    const res = await as(actor).delete(`/contact-inquiries/${inquiry.id}`);

    expect(res.status).toBe(200);
    expect(await db.ContactInquiry.findByPk(inquiry.id)).toBeNull();
    expect(await db.ContactInquiry.findByPk(inquiry.id, { paranoid: false })).not.toBeNull();
  });

  it("devuelve 401 sin el permiso", async () => {
    const actor = await createActor({ permissions: ["contact_inquiries_update"] });
    const inquiry = await createInquiry();
    const res = await as(actor).delete(`/contact-inquiries/${inquiry.id}`);
    expect(res.status).toBe(401);
  });

  it("deja pasar a admin_granted", async () => {
    const actor = await createActor({ role: "admin" });
    const inquiry = await createInquiry();
    const res = await as(actor).delete(`/contact-inquiries/${inquiry.id}`);
    expect(res.status).toBe(200);
  });
});
