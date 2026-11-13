"use strict";
// Conversión referencia guardada -> key del bucket y firma de URLs (helpers/r2Storage.js).
// La firma es offline (no hay llamada de red), así que se prueba con credenciales falsas.
process.env.STORAGE_PUBLIC_URL = "https://pub-test.r2.dev";
process.env.STORAGE_BUCKET = "bucket-test";
process.env.STORAGE_ACCESS_KEY_ID = "AKIAFAKEFAKEFAKE";
process.env.STORAGE_SECRET_ACCESS_KEY = "fake-secret";
process.env.STORAGE_R2_ENDPOINT = "https://account-id.r2.cloudflarestorage.com";

const { keyFromStoredUrl, getSignedFileUrl } = require("../../helpers/r2Storage");

describe("keyFromStoredUrl", () => {
  it("saca el prefijo público y devuelve la key", () => {
    expect(keyFromStoredUrl("https://pub-test.r2.dev/oca/uuid-1.pdf")).toBe("oca/uuid-1.pdf");
  });

  it("quita query y hash y decodifica", () => {
    expect(keyFromStoredUrl("https://pub-test.r2.dev/docs/a%20b.pdf?x=1#frag")).toBe("docs/a b.pdf");
  });

  it("si el dominio cambió, usa el pathname de la URL", () => {
    expect(keyFromStoredUrl("https://otro-dominio.com/oca/uuid-1.pdf")).toBe("oca/uuid-1.pdf");
  });

  it("rechaza valores vacíos, no-URL y no-strings", () => {
    expect(keyFromStoredUrl("")).toBeNull();
    expect(keyFromStoredUrl(null)).toBeNull();
    expect(keyFromStoredUrl(42)).toBeNull();
    expect(keyFromStoredUrl("no-es-una-url")).toBeNull();
    expect(keyFromStoredUrl("https://pub-test.r2.dev/")).toBeNull();
  });

  it("rechaza '..' (también codificado)", () => {
    expect(keyFromStoredUrl("https://pub-test.r2.dev/a/../b.pdf")).toBeNull();
    expect(keyFromStoredUrl("https://pub-test.r2.dev/a/%2e%2e/b.pdf")).toBeNull();
  });

  it("rechaza el prefijo bloqueado backups/", () => {
    expect(keyFromStoredUrl("https://pub-test.r2.dev/backups/daily/dump.sql.gz")).toBeNull();
    expect(keyFromStoredUrl("https://otro-dominio.com/backups/daily/dump.sql.gz")).toBeNull();
  });
});

describe("getSignedFileUrl", () => {
  it("firma la key con vencimiento de 10 minutos por defecto", async () => {
    const signed = await getSignedFileUrl("https://pub-test.r2.dev/oca/uuid-1.pdf");
    const url = new URL(signed);

    // El SDK usa estilo virtual-hosted: el bucket va en el host y la key en el path.
    expect(url.hostname).toBe("bucket-test.account-id.r2.cloudflarestorage.com");
    expect(url.pathname).toBe("/oca/uuid-1.pdf");
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
  });

  it("respeta expiresIn", async () => {
    const signed = await getSignedFileUrl("https://pub-test.r2.dev/oca/uuid-1.pdf", { expiresIn: 21600 });

    expect(new URL(signed).searchParams.get("X-Amz-Expires")).toBe("21600");
  });

  it("con downloadName pide Content-Disposition attachment", async () => {
    const signed = await getSignedFileUrl("https://pub-test.r2.dev/oca/uuid-1.pdf", { downloadName: "Pedido.pdf" });

    expect(new URL(signed).searchParams.get("response-content-disposition")).toContain("attachment");
  });

  it("devuelve null si la referencia es inválida o está bloqueada", async () => {
    expect(await getSignedFileUrl("https://pub-test.r2.dev/backups/daily/x.gz")).toBeNull();
    expect(await getSignedFileUrl("basura")).toBeNull();
  });
});
