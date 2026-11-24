"use strict";
// Certificado autofirmado de prueba (NO es de ARCA) para testear firma, credenciales y cifrado sin tocar ~/.arca.
const forge = require("node-forge");

function createTestCertificate({ commonName = "Test Conmomet", daysValid = 365 } = {}) {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 1024 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + daysValid * 86400000);
  const attrs = [{ name: "commonName", value: commonName }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    cert,
    privateKey: keys.privateKey,
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
}

const toB64 = (pem) => Buffer.from(pem, "utf8").toString("base64");

module.exports = { createTestCertificate, toB64 };
