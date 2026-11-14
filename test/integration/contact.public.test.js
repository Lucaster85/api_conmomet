"use strict";
// POST /public/contact (ver FLOWS.md §58): antes solo intentaba mandar un mail y, sin servidor,
// la consulta se perdía. Ahora se guarda, avisa por permiso y el mail queda detrás de un flag.
jest.mock("../../helpers/emailService", () => ({ sendEmail: jest.fn().mockResolvedValue({}) }));

const db = require("../../models");
const { sendEmail } = require("../../helpers/emailService");
const { createActor, request, app } = require("../helpers/auth");

const VALID = {
  motivo: "budget_request",
  nombre: "Marta Gómez",
  empresa: "Metalúrgica Sur",
  telefono: "2262456789",
  email: "marta@metalurgica.test",
  mensaje: "Necesitamos presupuesto para una parada de planta.",
};

const post = (body) => request(app).post("/public/contact").send(body);

// El aviso es fire-and-forget: se espera a que aparezca en vez de asumir que ya está.
async function waitFor(check, { tries = 40, delay = 25 } = {}) {
  for (let i = 0; i < tries; i += 1) {
    const value = await check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, delay));
  }
  return check();
}

beforeAll(() => { process.env.PUBLIC_FORM_RATE_LIMIT_MAX = "1000"; });
afterAll(() => { delete process.env.PUBLIC_FORM_RATE_LIMIT_MAX; });
beforeEach(() => {
  sendEmail.mockClear();
  delete process.env.CONTACT_EMAIL_ENABLED;
});

describe("POST /public/contact", () => {
  it("guarda la consulta tal cual la envió el visitante, con estado nuevo", async () => {
    const res = await post(VALID);

    expect(res.status).toBe(200);
    const rows = await db.ContactInquiry.findAll();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reason: "budget_request",
      name: "Marta Gómez",
      company: "Metalúrgica Sur",
      phone: "2262456789",
      email: "marta@metalurgica.test",
      message: VALID.mensaje,
      status: "new",
    });
  });

  it("guarda la IP y el user agent para rastrear abuso", async () => {
    await request(app).post("/public/contact").set("User-Agent", "TestBrowser/1.0").send(VALID);

    const row = await db.ContactInquiry.findOne();
    expect(row.user_agent).toBe("TestBrowser/1.0");
    expect(row.source_ip).toBeTruthy();
  });

  it("acepta solo teléfono, sin email", async () => {
    const res = await post({ ...VALID, email: "" });
    expect(res.status).toBe(200);
  });

  it("acepta solo email, sin teléfono", async () => {
    const res = await post({ ...VALID, telefono: "" });
    expect(res.status).toBe(200);
  });

  it("rechaza con 400 sin motivo o con un motivo desconocido, y no guarda nada", async () => {
    expect((await post({ ...VALID, motivo: undefined })).status).toBe(400);
    expect((await post({ ...VALID, motivo: "spam" })).status).toBe(400);
    expect(await db.ContactInquiry.count()).toBe(0);
  });

  it("rechaza con 400 sin nombre o sin mensaje", async () => {
    expect((await post({ ...VALID, nombre: "  " })).status).toBe(400);
    expect((await post({ ...VALID, mensaje: "" })).status).toBe(400);
    expect(await db.ContactInquiry.count()).toBe(0);
  });

  it("rechaza con 400 si no hay ni email ni teléfono", async () => {
    const res = await post({ ...VALID, email: "", telefono: "" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email o un teléfono/);
  });

  it("rechaza con 400 un email mal formado", async () => {
    const res = await post({ ...VALID, email: "no-es-un-email" });
    expect(res.status).toBe(400);
  });

  it("campo trampa completo: responde 200 igual que un envío válido pero no guarda ni avisa", async () => {
    const res = await post({ ...VALID, website: "http://spam.example" });

    expect(res.status).toBe(200);
    expect(res.body.message).toBeTruthy();
    expect(await db.ContactInquiry.count()).toBe(0);
    expect(await db.Notification.count()).toBe(0);
  });
});

describe("POST /public/contact — notificaciones", () => {
  it("avisa solo a quienes tienen contact_inquiries_read (por permiso directo o admin_granted)", async () => {
    const withPermission = await createActor({ permissions: ["contact_inquiries_read"] });
    const admin = await createActor({ role: "admin" });
    const without = await createActor({ permissions: ["quote_requests_read"] });

    await post(VALID);

    const inquiry = await db.ContactInquiry.findOne();
    await waitFor(async () => (await db.Notification.count()) >= 2);
    const forPermission = await db.Notification.findAll({ where: { user_id: withPermission.user.id } });
    const forAdmin = await db.Notification.findAll({ where: { user_id: admin.user.id } });
    const forWithout = await db.Notification.findAll({ where: { user_id: without.user.id } });

    expect(forPermission).toHaveLength(1);
    expect(forAdmin).toHaveLength(1);
    expect(forWithout).toHaveLength(0);
    expect(forPermission[0]).toMatchObject({
      type: "contact_inquiry_received",
      entity_type: "contact_inquiry",
      entity_id: inquiry.id,
      url: `/dashboard/contact-inquiries?view=${inquiry.id}`,
    });
    expect(forPermission[0].body).toContain("Marta Gómez");
    expect(forPermission[0].body).toContain("Pedido de presupuesto");
  });

  it("la consulta se guarda y responde 200 aunque no haya nadie a quien avisar", async () => {
    const res = await post(VALID);
    expect(res.status).toBe(200);
    expect(await db.ContactInquiry.count()).toBe(1);
  });
});

describe("POST /public/contact — mail", () => {
  it("no llama al servicio de mail con CONTACT_EMAIL_ENABLED apagado (default)", async () => {
    await post(VALID);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("con CONTACT_EMAIL_ENABLED=true manda el mail con los datos de la consulta", async () => {
    process.env.CONTACT_EMAIL_ENABLED = "true";

    const res = await post(VALID);

    expect(res.status).toBe(200);
    await waitFor(() => sendEmail.mock.calls.length > 0);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].data).toMatchObject({ nombre: "Marta Gómez", email: "marta@metalurgica.test" });
  });

  it("si el mail falla, la consulta queda guardada y la respuesta sigue siendo 200", async () => {
    process.env.CONTACT_EMAIL_ENABLED = "true";
    sendEmail.mockRejectedValueOnce(new Error("MailerSend trial caído"));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const res = await post(VALID);

    expect(res.status).toBe(200);
    expect(await db.ContactInquiry.count()).toBe(1);
    await waitFor(() => errorSpy.mock.calls.length > 0);
    errorSpy.mockRestore();
  });
});
