"use strict";
const { encryptSecret, decryptSecret } = require("../../services/arca/tokenCrypto");

describe("arca tokenCrypto (S1)", () => {
  const keyPem = "-----BEGIN PRIVATE KEY-----\nclave-de-prueba\n-----END PRIVATE KEY-----";

  it("cifra y descifra con la misma clave, y el texto cifrado no contiene el original", () => {
    const encrypted = encryptSecret("token-super-secreto", keyPem);
    expect(encrypted).not.toContain("token-super-secreto");
    expect(decryptSecret(encrypted, keyPem)).toBe("token-super-secreto");
  });

  it("dos cifrados del mismo valor son distintos (IV aleatorio)", () => {
    expect(encryptSecret("x", keyPem)).not.toBe(encryptSecret("x", keyPem));
  });

  it("devuelve null con otra clave (certificado renovado), texto alterado o formato inválido", () => {
    const encrypted = encryptSecret("token", keyPem);
    expect(decryptSecret(encrypted, "otra-clave")).toBeNull();
    const [v, iv, tag, data] = encrypted.split(":");
    expect(decryptSecret([v, iv, tag, Buffer.from("alterado").toString("base64")].join(":"), keyPem)).toBeNull();
    expect(decryptSecret("basura", keyPem)).toBeNull();
    expect(decryptSecret(null, keyPem)).toBeNull();
  });
});
