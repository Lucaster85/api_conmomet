"use strict";
const forge = require("node-forge");
const {
  buildLoginTicketRequest, signLoginTicket, parseLoginResponse, readCachedTicket, toArgentinaIso,
  RENEW_MARGIN_MS,
} = require("../../services/arca/ticket");
const { encryptSecret } = require("../../services/arca/tokenCrypto");
const { createTestCertificate } = require("../helpers/arcaCert");

describe("arca ticket de WSAA", () => {
  const now = new Date("2026-11-16T13:00:00.000Z"); // 10:00 en Argentina

  it("formatea las horas en UTC-3 fijo", () => {
    expect(toArgentinaIso(now)).toBe("2026-11-16T10:00:00-03:00");
  });

  it("arma el TRA con inicio 10 min antes y vencimiento 10 min después (B7)", () => {
    const xml = buildLoginTicketRequest("wsfe", now);
    expect(xml).toContain("<service>wsfe</service>");
    expect(xml).toContain("<generationTime>2026-11-16T09:50:00-03:00</generationTime>");
    expect(xml).toContain("<expirationTime>2026-11-16T10:10:00-03:00</expirationTime>");
    expect(xml).toContain(`<uniqueId>${Math.floor(now.getTime() / 1000)}</uniqueId>`);
  });

  it("firma el TRA en CMS: el contenido va incluido y el certificado también", () => {
    const { cert, privateKey } = createTestCertificate();
    const tra = buildLoginTicketRequest("wsfe", now);
    const b64 = signLoginTicket(tra, cert, privateKey);

    const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(forge.util.decode64(b64)));
    expect(p7.rawCapture.content.value.map((v) => v.value).join("")).toBe(tra);
    expect(p7.certificates).toHaveLength(1);
    expect(p7.rawCapture.signerInfos).toHaveLength(1);
  });

  it("lee token, sign y vencimiento de la respuesta", () => {
    const xml =
      "<loginTicketResponse><header><expirationTime>2026-11-17T01:00:00.000-03:00</expirationTime></header>" +
      "<credentials><token>TOK123</token><sign>SIG456</sign></credentials></loginTicketResponse>";
    const parsed = parseLoginResponse(xml);
    expect(parsed.token).toBe("TOK123");
    expect(parsed.sign).toBe("SIG456");
    expect(parsed.expiresAt.toISOString()).toBe("2026-11-17T04:00:00.000Z");
  });

  it("rechaza una respuesta sin credenciales o con vencimiento ilegible", () => {
    expect(() => parseLoginResponse("<x/>")).toThrow(/sin credenciales/);
    expect(() => parseLoginResponse("<token>a</token><sign>b</sign><expirationTime>nunca</expirationTime>")).toThrow(/ilegible/);
  });

  describe("readCachedTicket", () => {
    const keyPem = "clave-de-prueba";
    const row = (expiresInMs) => ({
      token_encrypted: encryptSecret("T", keyPem),
      sign_encrypted: encryptSecret("S", keyPem),
      expires_at: new Date(now.getTime() + expiresInMs),
    });

    it("reutiliza un ticket vigente", () => {
      const cached = readCachedTicket(row(6 * 3600 * 1000), keyPem, now.getTime());
      expect(cached.token).toBe("T");
      expect(cached.sign).toBe("S");
    });

    it("renueva cuando faltan 10 minutos o menos", () => {
      expect(readCachedTicket(row(RENEW_MARGIN_MS), keyPem, now.getTime())).toBeNull();
      expect(readCachedTicket(row(RENEW_MARGIN_MS + 60000), keyPem, now.getTime())).not.toBeNull();
    });

    it("trata como inexistente una fila vacía o cifrada con otra clave", () => {
      expect(readCachedTicket(null, keyPem, now.getTime())).toBeNull();
      expect(readCachedTicket({ token_encrypted: null }, keyPem, now.getTime())).toBeNull();
      expect(readCachedTicket(row(3600 * 1000), "otra-clave", now.getTime())).toBeNull();
    });
  });
});
