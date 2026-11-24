"use strict";
const { buildQrPayload, buildQrUrl, parseQrUrl, QR_BASE_URL } = require("../../services/arca/qr");

const invoice = {
  issue_date: "2026-11-17", pos_number: 3, cbte_tipo: 1, number: 5, total_amount: 1210, currency: "ARS", exchange_rate: null,
  recipient_doc_type: 80, recipient_doc_number: "30716396653", cae: "86461069911132",
};

describe("arca qr (RG 4892)", () => {
  it("arma el JSON del QR con los datos del comprobante, con números como número", () => {
    expect(buildQrPayload({ invoice, issuerCuit: "20317223456" })).toEqual({
      ver: 1, fecha: "2026-11-17", cuit: 20317223456, ptoVta: 3, tipoCmp: 1, nroCmp: 5, importe: 1210, moneda: "PES", ctz: 1,
      tipoDocRec: 80, nroDocRec: 30716396653, tipoCodAut: "E", codAut: 86461069911132,
    });
  });

  it("en dólares manda DOL, el importe en dólares y la cotización con 6 decimales", () => {
    const payload = buildQrPayload({ invoice: { ...invoice, currency: "USD", exchange_rate: 1480.1234567, total_amount: 1000.5 }, issuerCuit: "20317223456" });
    expect(payload).toMatchObject({ moneda: "DOL", ctz: 1480.123457, importe: 1000.5 });
  });

  it("para una FCE usa su código de comprobante (201)", () => {
    expect(buildQrPayload({ invoice: { ...invoice, cbte_tipo: 201 }, issuerCuit: "20317223456" }).tipoCmp).toBe(201);
  });

  it("la URL apunta al verificador de ARCA y el JSON vuelve íntegro (ida y vuelta)", () => {
    const payload = buildQrPayload({ invoice, issuerCuit: "20317223456" });
    const url = buildQrUrl(payload);
    expect(url.startsWith(`${QR_BASE_URL}?p=`)).toBe(true);
    expect(parseQrUrl(url)).toEqual(payload);
  });

  it("el CAE de 14 dígitos no pierde precisión como número", () => {
    expect(Number.isSafeInteger(buildQrPayload({ invoice: { ...invoice, cae: "99999999999999" }, issuerCuit: "20317223456" }).codAut)).toBe(true);
  });
});
