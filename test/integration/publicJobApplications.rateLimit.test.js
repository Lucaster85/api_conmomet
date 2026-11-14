"use strict";
// Tope de envíos por IP sobre la ruta REAL de /public/job-applications. Archivo propio: el contador
// vive en memoria del proceso, así arranca en cero.
jest.mock("../../helpers/r2Storage", () => ({
  ...jest.requireActual("../../helpers/r2Storage"),
  uploadToR2: jest.fn().mockResolvedValue("https://files.test/candidates/1/a.pdf"),
  deleteFromR2: jest.fn(),
}));

const db = require("../../models");
const { request, app } = require("../helpers/auth");

beforeAll(() => { process.env.PUBLIC_FORM_RATE_LIMIT_MAX = "2"; });
afterAll(() => { delete process.env.PUBLIC_FORM_RATE_LIMIT_MAX; });

const send = (dni) =>
  request(app)
    .post("/public/job-applications")
    .field("name", "A").field("lastname", "B").field("dni", dni).field("phone", "2262456789").field("consent", "true")
    .field("file_kinds", JSON.stringify(["cv"]))
    .attach("files", Buffer.from("%PDF"), { filename: "cv.pdf", contentType: "application/pdf" });

describe("POST /public/job-applications — rate limit", () => {
  it("responde 429 pasado el máximo y no guarda el excedente", async () => {
    expect((await send("30000001")).status).toBe(200);
    expect((await send("30000002")).status).toBe(200);

    const blocked = await send("30000003");

    expect(blocked.status).toBe(429);
    expect(await db.Candidate.count()).toBe(2);
  });
});
