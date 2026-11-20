"use strict";
const { getArcaConfig, loadCredentials, describeCertificate, logStartupStatus } = require("../../services/arca/credentials");
const { createTestCertificate, toB64 } = require("../helpers/arcaCert");

const VALID_CUIT = "20123456786";

describe("arca credentials", () => {
  let pair;
  beforeAll(() => { pair = createTestCertificate({ commonName: "Conmomet Homo" }); });

  const envWith = (extra) => ({ ARCA_ENV: "homologacion", ARCA_CUIT: VALID_CUIT, ...extra });
  const goodEnv = () => envWith({ ARCA_CERT_B64: toB64(pair.certPem), ARCA_KEY_B64: toB64(pair.keyPem) });

  describe("getArcaConfig", () => {
    it("sin ARCA_ENV la integración está apagada, sin error", () => {
      expect(getArcaConfig({})).toEqual({ enabled: false, env: null, cuit: null, error: null });
    });
    it("rechaza un ambiente desconocido y un CUIT inválido", () => {
      expect(getArcaConfig({ ARCA_ENV: "prod" }).error).toMatch(/inválido/);
      expect(getArcaConfig({ ARCA_ENV: "produccion", ARCA_CUIT: "123" }).error).toMatch(/ARCA_CUIT/);
    });
    it("queda habilitada con ambiente y CUIT válidos (acepta guiones y mayúsculas)", () => {
      const config = getArcaConfig({ ARCA_ENV: "Homologacion", ARCA_CUIT: "20-12345678-6" });
      expect(config).toEqual({ enabled: true, env: "homologacion", cuit: VALID_CUIT, error: null });
    });
  });

  describe("loadCredentials", () => {
    it("lee certificado y clave desde base64", () => {
      const creds = loadCredentials(goodEnv());
      expect(creds.certPem).toContain("BEGIN CERTIFICATE");
      expect(creds.keyPem).toContain("PRIVATE KEY");
    });

    it("falla con mensaje claro si falta el certificado o la clave, sin tirar por otra cosa", () => {
      expect(() => loadCredentials(envWith({}))).toThrow(/Falta el certificado/);
      expect(() => loadCredentials(envWith({ ARCA_CERT_B64: toB64(pair.certPem) }))).toThrow(/Falta la clave/);
    });

    it("falla si la clave no corresponde al certificado", () => {
      const other = createTestCertificate();
      expect(() => loadCredentials(envWith({ ARCA_CERT_B64: toB64(pair.certPem), ARCA_KEY_B64: toB64(other.keyPem) })))
        .toThrow(/no corresponde/);
    });

    it("falla con un certificado vencido", () => {
      const expired = createTestCertificate({ daysValid: -2 });
      expect(() => loadCredentials(envWith({ ARCA_CERT_B64: toB64(expired.certPem), ARCA_KEY_B64: toB64(expired.keyPem) })))
        .toThrow(/venció/);
    });

    it("no filtra la ruta del archivo en el error", () => {
      expect(() => loadCredentials(envWith({ ARCA_CERT_PATH: "/ruta/secreta/x.crt", ARCA_KEY_PATH: "/ruta/secreta/x.key" })))
        .toThrow(/no se pudo leer el archivo/);
      try { loadCredentials(envWith({ ARCA_CERT_PATH: "/ruta/secreta/x.crt", ARCA_KEY_PATH: "/ruta/secreta/x.key" })); }
      catch (e) { expect(e.message).not.toContain("/ruta/secreta"); }
    });
  });

  describe("describeCertificate / logStartupStatus (S5)", () => {
    it("devuelve titular y vencimiento, nunca la clave", () => {
      const info = describeCertificate(goodEnv());
      expect(info.ok).toBe(true);
      expect(info.subject).toBe("Conmomet Homo");
      expect(info.days_left).toBeGreaterThan(300);
      expect(info.expiring_soon).toBe(false);
      expect(JSON.stringify(info)).not.toContain("PRIVATE KEY");
    });

    it("marca como por vencer un certificado a menos de 30 días", () => {
      const soon = createTestCertificate({ daysValid: 10 });
      const info = describeCertificate(envWith({ ARCA_CERT_B64: toB64(soon.certPem), ARCA_KEY_B64: toB64(soon.keyPem) }));
      expect(info.ok).toBe(true);
      expect(info.expiring_soon).toBe(true);
    });

    it("loguea solo titular y vencimiento", () => {
      const log = { log: jest.fn(), warn: jest.fn() };
      logStartupStatus(goodEnv(), log);
      const line = log.log.mock.calls[0][0];
      expect(line).toContain("Conmomet Homo");
      expect(line).not.toMatch(/PRIVATE|BEGIN|[A-Za-z0-9+/]{60,}/);
    });

    it("avisa (sin tirar) cuando el certificado falta o está mal", () => {
      const log = { log: jest.fn(), warn: jest.fn() };
      logStartupStatus(envWith({}), log);
      expect(log.warn).toHaveBeenCalled();
    });
  });
});
