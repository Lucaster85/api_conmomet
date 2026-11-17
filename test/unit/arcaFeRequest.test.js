"use strict";
const {
  toArcaDate, fromArcaDate, daysBetween, checkIssueDate, validateEmission, buildCaeRequest, parseCaeResponse,
  describeRejection, buildIssuerSnapshot, buildRecipientSnapshot,
} = require("../../services/arca/feRequest");

const VALID_CUIT = "20123456786";
const OTHER_VALID_CUIT = "30716396653";

const baseInvoice = (overrides = {}) => ({
  cbte_tipo: 1, issue_date: "2026-11-16", due_date: "2026-12-16", currency: "ARS", exchange_rate: null, same_currency_payment: null,
  arca_concept: 1, service_from: null, service_to: null, recipient_doc_number: OTHER_VALID_CUIT, recipient_doc_type: 80,
  recipient_vat_condition_id: 1, iva_rate: 21, net_amount: 1000, iva_amount: 210, total_amount: 1210, lines: [{ concept: "labor" }],
  ...overrides,
});
const company = {
  legal_name: "CONMOMET S.A", cuit: VALID_CUIT, vat_condition: "responsable_inscripto", address_street: "578 1682",
  address_locality: "Quequén", address_province: "Buenos Aires",
};
const pointOfSale = { number: 3, type: "web_service", is_active: true, usage_description: "Obras" };
const config = { enabled: true, env: "homologacion", cuit: VALID_CUIT, error: null };
const client = { cuit: OTHER_VALID_CUIT, tax_condition: "responsable_inscripto", razonSocial: "BUNGE" };
const validate = (over = {}) => validateEmission({ invoice: baseInvoice(over.invoice), client: over.client || client, pointOfSale: over.pointOfSale === undefined ? pointOfSale : over.pointOfSale, company: over.company || company, config: over.config || config, today: "2026-11-16" });

describe("arca feRequest — fechas", () => {
  it("convierte entre YYYY-MM-DD y el formato de ARCA", () => {
    expect(toArcaDate("2026-11-16")).toBe("20261116");
    expect(fromArcaDate("20261116")).toBe("2026-11-16");
    expect(fromArcaDate("")).toBeNull();
    expect(fromArcaDate(undefined)).toBeNull();
    expect(fromArcaDate("2026-11-16")).toBeNull();
  });

  it("calcula días entre fechas sin depender de la zona horaria", () => {
    expect(daysBetween("2026-11-16", "2026-11-21")).toBe(5);
    expect(daysBetween("2026-11-16", "2026-11-10")).toBe(-6);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
  });

  it("con productos acepta hasta 5 días de diferencia, con servicios hasta 10 (B3)", () => {
    expect(checkIssueDate("2026-11-21", 1, "2026-11-16")).toBeNull();
    expect(checkIssueDate("2026-11-22", 1, "2026-11-16")).toMatch(/5 días/);
    expect(checkIssueDate("2026-11-06", 1, "2026-11-16")).toMatch(/5 días/);
    expect(checkIssueDate("2026-11-26", 2, "2026-11-16")).toBeNull();
    expect(checkIssueDate("2026-11-27", 3, "2026-11-16")).toMatch(/10 días/);
  });
});

describe("arca feRequest — validateEmission", () => {
  it("una factura completa no tiene problemas", () => {
    expect(validate()).toEqual([]);
  });

  it("con la integración apagada o mal configurada, lo dice y no sigue", () => {
    expect(validate({ config: { enabled: false, error: null } })).toEqual(["La integración con ARCA está apagada en este servidor."]);
    expect(validate({ config: { enabled: false, error: "ARCA_CUIT falta" } })).toEqual(["ARCA_CUIT falta"]);
  });

  it("solo emite Factura A por ahora", () => {
    expect(validate({ invoice: { cbte_tipo: 201 } }).join()).toMatch(/solo emite Factura A/);
  });

  it("exige un punto de venta de web service y activo", () => {
    expect(validate({ pointOfSale: null }).join()).toMatch(/Elegí el punto de venta/);
    expect(validate({ pointOfSale: { ...pointOfSale, type: "manual" } }).join()).toMatch(/Comprobantes en línea/);
    expect(validate({ pointOfSale: { ...pointOfSale, is_active: false } }).join()).toMatch(/inactivo/);
  });

  it("exige datos completos de la empresa y que sea Responsable Inscripto", () => {
    expect(validate({ company: { ...company, legal_name: null, address_street: null } }).join()).toMatch(/falta: razón social, domicilio comercial/);
    expect(validate({ company: { ...company, cuit: "123" } }).join()).toMatch(/CUIT válido/);
    expect(validate({ company: { ...company, vat_condition: "monotributo" } }).join()).toMatch(/Responsable Inscripto/);
  });

  it("en producción frena si el CUIT de la conexión no es el de la empresa; en homologación lo deja pasar", () => {
    const mismatch = { ...config, cuit: OTHER_VALID_CUIT };
    expect(validate({ config: { ...mismatch, env: "produccion" } }).join()).toMatch(/no coincide/);
    expect(validate({ config: mismatch })).toEqual([]);
  });

  it("exige CUIT válido y una condición de IVA que admita Factura A", () => {
    expect(validate({ client: { ...client, cuit: null } }).join()).toMatch(/CUIT válido/);
    expect(validate({ client: { ...client, tax_condition: "exento" }, invoice: { recipient_vat_condition_id: null } }).join()).toMatch(/no admite Factura A/);
    expect(validate({ client: { ...client, tax_condition: null }, invoice: { recipient_vat_condition_id: null } }).join()).toMatch(/condición frente al IVA/);
    // 13 y 16 (monotributo social / promovido) también son válidas para la clase A.
    expect(validate({ invoice: { recipient_vat_condition_id: 13 } })).toEqual([]);
    expect(validate({ invoice: { recipient_vat_condition_id: 5 } }).join()).toMatch(/condición frente al IVA/);
  });

  it("con servicios exige período y vencimiento coherentes", () => {
    const services = { arca_concept: 2, issue_date: "2026-11-16" };
    expect(validate({ invoice: services }).join()).toMatch(/período facturado/);
    expect(validate({ invoice: { ...services, service_from: "2026-11-01", service_to: "2026-11-30", due_date: null } }).join()).toMatch(/vencimiento de pago/);
    expect(validate({ invoice: { ...services, service_from: "2026-11-30", service_to: "2026-11-01", due_date: "2026-12-10" } }).join()).toMatch(/desde es posterior/);
    expect(validate({ invoice: { ...services, service_from: "2026-11-01", service_to: "2026-11-30", due_date: "2026-11-01" } }).join()).toMatch(/anterior a la fecha de emisión/);
    expect(validate({ invoice: { ...services, service_from: "2026-11-01", service_to: "2026-11-30", due_date: "2026-12-10" } })).toEqual([]);
  });

  it("valida el concepto y la fecha de emisión", () => {
    expect(validate({ invoice: { arca_concept: null } }).join()).toMatch(/concepto/);
    expect(validate({ invoice: { issue_date: "2026-12-30" } }).join()).toMatch(/5 días/);
  });

  it("en dólares exige cotización y si se cobra en la misma moneda", () => {
    const usd = { currency: "USD", exchange_rate: 1480, same_currency_payment: false };
    expect(validate({ invoice: usd })).toEqual([]);
    expect(validate({ invoice: { ...usd, exchange_rate: null } }).join()).toMatch(/cotización/);
    expect(validate({ invoice: { ...usd, same_currency_payment: null } }).join()).toMatch(/misma moneda/);
  });

  it("rechaza importes en cero, alícuotas que ARCA no tiene y facturas sin líneas", () => {
    expect(validate({ invoice: { net_amount: 0, total_amount: 0 } }).join()).toMatch(/importe mayor a cero/);
    expect(validate({ invoice: { iva_rate: 13 } }).join()).toMatch(/alícuota/);
    expect(validate({ invoice: { lines: [] } }).join()).toMatch(/sin líneas|no tiene líneas/);
  });
});

describe("arca feRequest — buildCaeRequest", () => {
  const build = (over) => buildCaeRequest({ invoice: baseInvoice(over), number: 7, pointOfSale });
  const detailOf = (req) => req.FeCAEReq.FeDetReq.FECAEDetRequest[0];

  it("arma la cabecera y el detalle de una factura A en pesos con productos", () => {
    const req = build();
    expect(req.FeCAEReq.FeCabReq).toEqual({ CantReg: 1, PtoVta: 3, CbteTipo: 1 });
    const d = detailOf(req);
    expect(d).toMatchObject({
      Concepto: 1, DocTipo: 80, DocNro: Number(OTHER_VALID_CUIT), CbteDesde: 7, CbteHasta: 7, CbteFch: "20261116",
      ImpTotal: 1210, ImpTotConc: 0, ImpNeto: 1000, ImpOpEx: 0, ImpTrib: 0, ImpIVA: 210, MonId: "PES", MonCotiz: 1,
      CondicionIVAReceptorId: 1,
    });
    expect(d.Iva).toEqual({ AlicIva: [{ Id: 5, BaseImp: 1000, Importe: 210 }] });
    expect(d).not.toHaveProperty("FchServDesde");
    expect(d).not.toHaveProperty("CanMisMonExt");
  });

  it("respeta el ORDEN de campos del WSDL de ARCA (ASMX es sensible al orden)", () => {
    const keys = Object.keys(detailOf(build({ arca_concept: 2, service_from: "2026-11-01", service_to: "2026-11-30", due_date: "2026-12-10", currency: "USD", exchange_rate: 1480, same_currency_payment: true })));
    const expectedOrder = ["Concepto", "DocTipo", "DocNro", "CbteDesde", "CbteHasta", "CbteFch", "ImpTotal", "ImpTotConc", "ImpNeto", "ImpOpEx", "ImpTrib", "ImpIVA", "FchServDesde", "FchServHasta", "FchVtoPago", "MonId", "MonCotiz", "CanMisMonExt", "CondicionIVAReceptorId", "Iva"];
    expect(keys).toEqual(expectedOrder);
  });

  it("con servicios agrega el período y el vencimiento", () => {
    const d = detailOf(build({ arca_concept: 3, service_from: "2026-11-01", service_to: "2026-11-30", due_date: "2026-12-10" }));
    expect(d).toMatchObject({ Concepto: 3, FchServDesde: "20261101", FchServHasta: "20261130", FchVtoPago: "20261210" });
  });

  it("en dólares manda DOL, la cotización con 6 decimales y CanMisMonExt", () => {
    const same = detailOf(build({ currency: "USD", exchange_rate: 1480.1234567, same_currency_payment: true }));
    expect(same).toMatchObject({ MonId: "DOL", MonCotiz: 1480.123457, CanMisMonExt: "S" });
    expect(detailOf(build({ currency: "USD", exchange_rate: 1480, same_currency_payment: false })).CanMisMonExt).toBe("N");
  });

  it("el total es neto + IVA y el IVA se arma por alícuota sobre la base total (B11)", () => {
    const d = detailOf(build({ net_amount: 333.33, iva_amount: 70, total_amount: 999 }));
    expect(d.ImpTotal).toBe(403.33);
    expect(d.Iva.AlicIva[0]).toEqual({ Id: 5, BaseImp: 333.33, Importe: 70 });
  });

  it("usa el Id de ARCA de cada alícuota", () => {
    expect(detailOf(build({ iva_rate: 10.5 })).Iva.AlicIva[0].Id).toBe(4);
    expect(detailOf(build({ iva_rate: 27 })).Iva.AlicIva[0].Id).toBe(6);
    expect(detailOf(build({ iva_rate: 0, iva_amount: 0 })).Iva.AlicIva[0].Id).toBe(3);
  });
});

describe("arca feRequest — parseCaeResponse", () => {
  const approved = {
    FeCabResp: { Resultado: "A", FchProceso: "20261116101010" },
    FeDetResp: { FECAEDetResponse: [{ Resultado: "A", CbteDesde: 7, CAE: "76123456789012", CAEFchVto: "20261126" }] },
  };

  it("lee una factura aprobada", () => {
    expect(parseCaeResponse(approved)).toMatchObject({ approved: true, cae: "76123456789012", cae_expiration: "2026-11-26", number: 7, resultado: "A" });
  });

  it("no la considera aprobada sin CAE aunque diga A", () => {
    const noCae = { FeDetResp: { FECAEDetResponse: { Resultado: "A", CbteDesde: 7 } } };
    expect(parseCaeResponse(noCae).approved).toBe(false);
  });

  it("lee las observaciones de un rechazo y las describe", () => {
    const rejected = {
      FeCabResp: { Resultado: "R" },
      FeDetResp: { FECAEDetResponse: { Resultado: "R", Observaciones: { Obs: [{ Code: 10016, Msg: "El numero o fecha del comprobante no se corresponde" }, { Code: 10015, Msg: "Otro" }] } } },
    };
    const parsed = parseCaeResponse(rejected);
    expect(parsed.approved).toBe(false);
    expect(parsed.observations).toHaveLength(2);
    expect(describeRejection(parsed)).toBe("(10016) El numero o fecha del comprobante no se corresponde · (10015) Otro");
  });

  it("describe un rechazo sin motivo y tolera respuestas vacías", () => {
    expect(describeRejection(parseCaeResponse({}))).toBe("ARCA no devolvió el motivo.");
    expect(parseCaeResponse(undefined).approved).toBe(false);
  });
});

describe("arca feRequest — snapshots (S9)", () => {
  it("congela emisor y receptor sin referencias a los registros vivos", () => {
    const issuer = buildIssuerSnapshot({ ...company, display_name: null, iibb_number: "30716396653", email: "a@b.com" }, { number: 3, usage_description: "Obras", address: null });
    expect(issuer).toMatchObject({ legal_name: "CONMOMET S.A", display_name: "CONMOMET S.A", cuit: VALID_CUIT, iibb_number: "30716396653", point_of_sale: { number: 3, usage_description: "Obras" } });
    expect(issuer.address).toEqual({ street: "578 1682", number: null, locality: "Quequén", province: "Buenos Aires" });

    const recipient = buildRecipientSnapshot({ razonSocial: "BUNGE", cuit: OTHER_VALID_CUIT, fiscal_street: "Ruta 1", fiscal_locality: "Tancacha", fiscal_province: "Córdoba" }, baseInvoice());
    expect(recipient).toMatchObject({ legal_name: "BUNGE", cuit: OTHER_VALID_CUIT, doc_type: 80, vat_condition_id: 1, vat_condition: "IVA Responsable Inscripto" });
    expect(recipient.address).toEqual({ street: "Ruta 1", locality: "Tancacha", province: "Córdoba" });
  });
});
