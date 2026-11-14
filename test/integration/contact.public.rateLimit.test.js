"use strict";
// El tope de envíos por IP sobre la ruta REAL de /public/contact. Va en su propio archivo porque
// el contador vive en memoria del proceso: así arranca en cero y no se mezcla con los otros tests.
const db = require("../../models");
const { request, app } = require("../helpers/auth");

const VALID = {
  motivo: "general",
  nombre: "Pablo",
  telefono: "2262111111",
  mensaje: "Hola",
};

beforeAll(() => { process.env.PUBLIC_FORM_RATE_LIMIT_MAX = "3"; });
afterAll(() => { delete process.env.PUBLIC_FORM_RATE_LIMIT_MAX; });

describe("POST /public/contact — rate limit", () => {
  it("responde 429 desde el envío siguiente al máximo y no guarda el excedente", async () => {
    for (let i = 0; i < 3; i += 1) {
      expect((await request(app).post("/public/contact").send(VALID)).status).toBe(200);
    }

    const blocked = await request(app).post("/public/contact").send(VALID);

    expect(blocked.status).toBe(429);
    expect(await db.ContactInquiry.count()).toBe(3);
  });
});
