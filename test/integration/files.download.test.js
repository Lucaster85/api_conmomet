"use strict";
// Descarga forzada de archivos del bucket (GET /files/download), usada por el botón "Descargar"
// del visor de documentos del frontend (FLOWS.md §54). Solo lleva verifyToken, sin authPermission
// (las URLs del bucket ya son públicas), así que no hay matriz de permisos que ejercitar: se cubre
// la autenticación, la validación de la URL y los headers de la respuesta. El bucket se mockea.
const { Readable } = require("stream");
const request = require("supertest");

jest.mock("../../helpers/r2Storage", () => ({
  uploadToR2: jest.fn(),
  deleteFromR2: jest.fn(),
  getFromR2: jest.fn(),
}));

const { getFromR2 } = require("../../helpers/r2Storage");
const app = require("../../app");
const { createActor, as } = require("../helpers/auth");

const FILE_URL = "https://files.test/quote-requests/1/abc.doc";

describe("GET /files/download", () => {
  beforeEach(() => getFromR2.mockReset());

  it("rechaza sin token", async () => {
    const res = await request(app).get("/files/download").query({ url: FILE_URL });

    expect(res.status).toBe(401);
    expect(getFromR2).not.toHaveBeenCalled();
  });

  it("entrega el archivo con descarga forzada y el nombre pedido", async () => {
    getFromR2.mockResolvedValue({
      body: Readable.from([Buffer.from("contenido")]),
      contentType: "application/msword",
      contentLength: 9,
      key: "quote-requests/1/abc.doc",
    });
    const actor = await createActor();

    const res = await as(actor).get("/files/download").query({ url: FILE_URL, name: "Pedido original.doc" });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/msword");
    expect(res.headers["content-disposition"]).toMatch(/^attachment;/);
    expect(res.headers["content-disposition"]).toContain('filename="Pedido original.doc"');
  });

  it("sin nombre usa el de la key del bucket", async () => {
    getFromR2.mockResolvedValue({
      body: Readable.from([Buffer.from("x")]),
      contentType: "application/pdf",
      key: "invoices/5/uuid-1.pdf",
    });
    const actor = await createActor();

    const res = await as(actor).get("/files/download").query({ url: FILE_URL });

    expect(res.headers["content-disposition"]).toContain("uuid-1.pdf");
  });

  it("devuelve 400 si falta la URL", async () => {
    const actor = await createActor();

    const res = await as(actor).get("/files/download");

    expect(res.status).toBe(400);
  });

  it("devuelve 400 si la URL no es del bucket", async () => {
    getFromR2.mockResolvedValue(null);
    const actor = await createActor();

    const res = await as(actor).get("/files/download").query({ url: "https://otro-sitio.com/archivo.pdf" });

    expect(res.status).toBe(400);
  });

  it("devuelve 404 si el archivo ya no existe en el bucket", async () => {
    getFromR2.mockRejectedValue(Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" }));
    const actor = await createActor();

    const res = await as(actor).get("/files/download").query({ url: FILE_URL });

    expect(res.status).toBe(404);
  });
});
