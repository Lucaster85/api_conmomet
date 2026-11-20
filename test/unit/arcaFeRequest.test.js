"use strict";
const {
  toArcaDate, fromArcaDate, daysBetween, checkIssueDate, validateEmission, buildCaeRequest, parseCaeResponse,
  describeRejection, explainRejection, buildIssuerSnapshot, buildRecipientSnapshot, isFce,
  isFceInvoice, isFceNote, isCreditNote, isDebitNote, isNote, noteCbteFor,
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

  it("solo emite Factura A, FCE A y sus notas por ahora (no B, C ni E)", () => {
    expect(validate({ invoice: { cbte_tipo: 6 } }).join()).toMatch(/solo emite Factura A, Factura de Crédito Electrónica/);
    expect(validate({ invoice: { cbte_tipo: 8 } }).join()).toMatch(/solo emite Factura A, Factura de Crédito Electrónica/);
  });

  it("no deja facturarle a la propia empresa (ARCA 10069)", () => {
    expect(validate({ client: { ...client, cuit: company.cuit } }).join()).toMatch(/no puede ser el mismo que el de la empresa/);
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

describe("arca feRequest — Factura de Crédito Electrónica (FCE)", () => {
  const bank = { cbu: "0170099220000067797370", alias: "CONMOMET.COBROS", bank_name: "Banco X", is_active: true };
  const fceInvoice = (over = {}) => baseInvoice({ cbte_tipo: 201, fce_transfer_option: "SCA", commercial_reference: "OC 4104017010", ...over });
  const validateFce = (over = {}) => validateEmission({
    invoice: fceInvoice(over.invoice), client: over.client || client, pointOfSale, bankAccount: over.bankAccount === undefined ? bank : over.bankAccount,
    company, config, today: "2026-11-16",
  });

  it("una FCE completa no tiene problemas, ni con productos (necesita vencimiento igual)", () => {
    expect(validateFce()).toEqual([]);
    expect(isFce(201)).toBe(true);
    expect(isFce(1)).toBe(false);
  });

  it("exige cuenta bancaria activa con un CBU válido (homologación no controla el dígito verificador)", () => {
    expect(validateFce({ bankAccount: null }).join()).toMatch(/cuenta bancaria del emisor/);
    expect(validateFce({ bankAccount: { ...bank, is_active: false } }).join()).toMatch(/inactiva/);
    expect(validateFce({ bankAccount: { ...bank, cbu: "0170099220000067797380" } }).join()).toMatch(/CBU .* no es válido/);
    expect(validateFce({ bankAccount: { ...bank, alias: "x" } }).join()).toMatch(/alias/);
  });

  it("exige la opción de transferencia SCA o ADC", () => {
    expect(validateFce({ invoice: { fce_transfer_option: null } }).join()).toMatch(/opción de transferencia/);
    expect(validateFce({ invoice: { fce_transfer_option: "XXX" } }).join()).toMatch(/opción de transferencia/);
    expect(validateFce({ invoice: { fce_transfer_option: "ADC" } })).toEqual([]);
  });

  it("exige el vencimiento de pago aunque el concepto sea solo productos, sin repetir el mensaje con servicios", () => {
    expect(validateFce({ invoice: { due_date: null } }).join()).toMatch(/necesita el vencimiento de pago/);
    expect(validateFce({ invoice: { due_date: "2026-11-01" } }).join()).toMatch(/anterior a la fecha de emisión/);
    const services = validateFce({ invoice: { arca_concept: 2, service_from: "2026-11-01", service_to: "2026-11-30", due_date: null } });
    expect(services.filter((p) => /vencimiento de pago/.test(p))).toHaveLength(1);
  });

  it("la referencia comercial admite hasta 50 caracteres (ARCA 10189)", () => {
    expect(validateFce({ invoice: { commercial_reference: "x".repeat(50) } })).toEqual([]);
    expect(validateFce({ invoice: { commercial_reference: "x".repeat(51) } }).join()).toMatch(/hasta 50 caracteres/);
  });

  it("una Factura A no pide nada de esto", () => {
    expect(validate({ invoice: { due_date: null } })).toEqual([]);
  });

  describe("buildCaeRequest", () => {
    const build = (over, b = bank) => buildCaeRequest({ invoice: fceInvoice(over), number: 6, pointOfSale, bankAccount: b });
    const detail = (req) => req.FeCAEReq.FeDetReq.FECAEDetRequest[0];

    it("manda el tipo 201, el vencimiento (aunque sean productos) y los opcionales en orden: CBU, alias, transferencia y referencia", () => {
      const req = build();
      expect(req.FeCAEReq.FeCabReq.CbteTipo).toBe(201);
      const d = detail(req);
      expect(d.FchVtoPago).toBe("20261216");
      expect(d.Opcionales).toEqual({
        Opcional: [
          { Id: "2101", Valor: "0170099220000067797370" },
          { Id: "2102", Valor: "CONMOMET.COBROS" },
          { Id: "27", Valor: "SCA" },
          { Id: "23", Valor: "OC 4104017010" },
        ],
      });
    });

    it("respeta el orden del WSDL: el vencimiento antes de la moneda y los opcionales después del IVA", () => {
      const keys = Object.keys(detail(build()));
      expect(keys.indexOf("FchVtoPago")).toBeLessThan(keys.indexOf("MonId"));
      expect(keys.indexOf("Opcionales")).toBeGreaterThan(keys.indexOf("Iva"));
      expect(keys[keys.length - 1]).toBe("Opcionales");
    });

    it("omite el alias y la referencia comercial si no hay, y normaliza el CBU", () => {
      const d = detail(build({ commercial_reference: null, fce_transfer_option: "ADC" }, { ...bank, alias: null, cbu: "0170 0992 2000 0067 7973 70" }));
      expect(d.Opcionales.Opcional).toEqual([{ Id: "2101", Valor: "0170099220000067797370" }, { Id: "27", Valor: "ADC" }]);
    });

    it("con servicios suma el período y en dólares CanMisMonExt", () => {
      const d = detail(build({ arca_concept: 2, service_from: "2026-11-01", service_to: "2026-11-30", currency: "USD", exchange_rate: 1480, same_currency_payment: true }));
      expect(d).toMatchObject({ Concepto: 2, FchServDesde: "20261101", FchServHasta: "20261130", MonId: "DOL", CanMisMonExt: "S" });
    });

    it("una Factura A no lleva opcionales ni vencimiento con productos", () => {
      const d = detail(buildCaeRequest({ invoice: baseInvoice(), number: 1, pointOfSale }));
      expect(d).not.toHaveProperty("Opcionales");
      expect(d).not.toHaveProperty("FchVtoPago");
    });
  });

  describe("explainRejection", () => {
    it("agrega qué hacer a los rechazos conocidos de ARCA", () => {
      expect(explainRejection("ARCA rechazó: (10176) no se encuentra registrado", [10176], { cbteTipo: 201, env: "produccion" })).toMatch(/revisá su CUIT en Clientes/);
      expect(explainRejection("(10069) igual al emisor", [10069], {})).toMatch(/no puede ser el mismo/);
      expect(explainRejection("(10168) CBU", [10168], {})).toMatch(/elegí una cuenta/);
      expect(explainRejection("(10216)", [10216], {})).toMatch(/SCA o ADC/);
      expect(explainRejection("(10163)", [10163], {})).toMatch(/vencimiento de pago/);
      expect(explainRejection("(10189)", [10189], {})).toMatch(/50 caracteres/);
    });

    it("en homologación aclara que solo funcionan algunos CUIT de prueba como cliente de una FCE", () => {
      expect(explainRejection("x", [10176], { env: "homologacion" })).toMatch(/33693450239/);
      expect(explainRejection("x", [10176], { env: "produccion" })).not.toMatch(/33693450239/);
    });

    it("no repite una explicación y deja igual un código desconocido", () => {
      const text = explainRejection("x", [10162, 10162], {});
      expect(text.match(/Una FCE necesita cuenta bancaria/g)).toHaveLength(1);
      expect(explainRejection("(99999) raro", [99999], { cbteTipo: 201 })).toBe("(99999) raro");
    });

    it("una Factura A rechazada con un mensaje de factura de crédito sugiere emitir FCE (heurística)", () => {
      expect(explainRejection("(1) Debe emitir Factura de Crédito Electrónica MiPyMEs", [1], { cbteTipo: 1 })).toMatch(/probá emitiéndola/);
      expect(explainRejection("(1) Debe emitir Factura de Crédito Electrónica MiPyMEs", [1], { cbteTipo: 201 })).not.toMatch(/probá emitiéndola/);
      expect(explainRejection("(2) Fecha inválida", [2], { cbteTipo: 1 })).toBe("(2) Fecha inválida");
    });
  });

  it("el snapshot del emisor congela el CBU y el alias solo cuando se pasa la cuenta", () => {
    const withBank = buildIssuerSnapshot(company, pointOfSale, bank);
    expect(withBank.bank).toEqual({ bank_name: "Banco X", cbu: "0170099220000067797370", alias: "CONMOMET.COBROS" });
    expect(buildIssuerSnapshot(company, pointOfSale)).not.toHaveProperty("bank");
  });
});

describe("arca feRequest — notas de crédito y de débito", () => {
  const original = (over = {}) => ({
    cbte_tipo: 1, pos_number: 3, number: 7, issue_date: "2026-11-10", kind: "invoice", arca_status: "authorized", status: "pending",
    currency: "ARS", fce_acceptance: null, ...over,
  });
  const noteInvoice = (over = {}) => baseInvoice({ cbte_tipo: 3, kind: "credit_note", issue_date: "2026-11-16", ...over });
  const validateNote = (over = {}) => validateEmission({
    invoice: noteInvoice(over.invoice), client, pointOfSale, associated: over.associated === undefined ? original() : over.associated,
    company, config, today: "2026-11-16",
  });

  it("reconoce los tipos de nota y de FCE", () => {
    expect([isCreditNote(3), isCreditNote(203), isCreditNote(2)]).toEqual([true, true, false]);
    expect([isDebitNote(2), isDebitNote(202), isDebitNote(3)]).toEqual([true, true, false]);
    expect([isNote(3), isNote(202), isNote(1), isNote(201)]).toEqual([true, true, false, false]);
    expect([isFceInvoice(201), isFceInvoice(203)]).toEqual([true, false]);
    expect([isFceNote(203), isFceNote(202), isFceNote(201), isFceNote(3)]).toEqual([true, true, false, false]);
  });

  it("el tipo de la nota sale del tipo de la factura original", () => {
    expect(noteCbteFor(1, "credit_note")).toBe(3);
    expect(noteCbteFor(1, "debit_note")).toBe(2);
    expect(noteCbteFor(201, "credit_note")).toBe(203);
    expect(noteCbteFor(201, "debit_note")).toBe(202);
    expect(noteCbteFor(6, "credit_note")).toBeNull();
  });

  describe("validateEmission", () => {
    it("una nota de crédito con su factura emitida no tiene problemas", () => {
      expect(validateNote()).toEqual([]);
    });

    it("exige la factura original, emitida, sin anular, que sea una factura y del tipo que corresponde (ARCA 10197)", () => {
      expect(validateNote({ associated: null }).join()).toMatch(/necesita la factura original/);
      expect(validateNote({ associated: original({ arca_status: "draft" }) }).join()).toMatch(/todavía no fue emitida/);
      expect(validateNote({ associated: original({ status: "cancelled" }) }).join()).toMatch(/está anulada/);
      expect(validateNote({ associated: original({ kind: "credit_note" }) }).join()).toMatch(/no a otra nota/);
      expect(validateNote({ associated: original({ cbte_tipo: 201 }) }).join()).toMatch(/no corresponde al tipo/);
      expect(validateNote({ invoice: { cbte_tipo: 203 } }).join()).toMatch(/no corresponde al tipo/);
    });

    it("la nota tiene que estar en la moneda de la original y no puede ser anterior a ella", () => {
      expect(validateNote({ invoice: { currency: "USD", exchange_rate: 1480, same_currency_payment: true } }).join()).toMatch(/misma moneda/);
      expect(validateNote({ invoice: { issue_date: "2026-11-09" } }).join()).toMatch(/no puede ser anterior a la de la factura original/);
    });

    it("una nota por diferencia de cambio va en pesos y sobre una factura en dólares", () => {
      const usdOriginal = original({ currency: "USD" });
      const diff = (over = {}) => ({ exchange_difference: true, currency: "ARS", exchange_rate: null, same_currency_payment: null, ...over });
      expect(validateNote({ invoice: diff(), associated: usdOriginal })).toEqual([]);
      expect(validateNote({ invoice: diff({ cbte_tipo: 2, kind: "debit_note" }), associated: usdOriginal })).toEqual([]);
      // Sobre una factura en pesos no corresponde, ni en dólares.
      expect(validateNote({ invoice: diff(), associated: original() }).join()).toMatch(/va en pesos y sobre una factura en dólares/);
      expect(validateNote({ invoice: diff({ currency: "USD", exchange_rate: 1480, same_currency_payment: true }), associated: usdOriginal }).join()).toMatch(/va en pesos/);
    });

    it("la marca de anulación de una nota de FCE solo vale si el cliente rechazó la FCE (ARCA 10154)", () => {
      const fceNote = (over = {}) => ({ cbte_tipo: 203, fce_annulment: true, ...over });
      const fceOriginal = (acceptance) => original({ cbte_tipo: 201, fce_acceptance: acceptance });
      expect(validateNote({ invoice: fceNote(), associated: fceOriginal("pending") }).join()).toMatch(/solo corresponde si el cliente la rechazó/);
      expect(validateNote({ invoice: fceNote(), associated: fceOriginal("accepted") }).join()).toMatch(/solo corresponde si el cliente la rechazó/);
      expect(validateNote({ invoice: fceNote(), associated: fceOriginal("rejected") })).toEqual([]);
      expect(validateNote({ invoice: fceNote({ fce_annulment: false }), associated: fceOriginal("pending") })).toEqual([]);
    });

    it("una nota de FCE no pide cuenta bancaria, opción de transferencia ni vencimiento", () => {
      const problems = validateNote({ invoice: { cbte_tipo: 203, due_date: null, fce_transfer_option: null }, associated: original({ cbte_tipo: 201 }) });
      expect(problems).toEqual([]);
    });

    it("una nota de Factura A con servicios pide período y vencimiento, como la factura", () => {
      expect(validateNote({ invoice: { arca_concept: 2, service_from: null, service_to: null, due_date: null } }).join()).toMatch(/período facturado/);
    });
  });

  describe("buildCaeRequest", () => {
    const assoc = original();
    const build = (over = {}, associated = assoc) => buildCaeRequest({ invoice: noteInvoice(over), number: 4, pointOfSale, associated, issuerCuit: VALID_CUIT });
    const detail = (req) => req.FeCAEReq.FeDetReq.FECAEDetRequest[0];

    it("una NC de Factura A informa el comprobante asociado: tipo, punto de venta, número, CUIT del emisor y fecha", () => {
      const req = build();
      expect(req.FeCAEReq.FeCabReq.CbteTipo).toBe(3);
      expect(detail(req).CbtesAsoc).toEqual({ CbteAsoc: [{ Tipo: 1, PtoVta: 3, Nro: 7, Cuit: VALID_CUIT, CbteFch: "20261110" }] });
      expect(detail(req)).not.toHaveProperty("Opcionales");
    });

    it("respeta el orden del WSDL: CbtesAsoc entre la condición de IVA del receptor y el IVA", () => {
      const keys = Object.keys(detail(build()));
      expect(keys.indexOf("CbtesAsoc")).toBe(keys.indexOf("CondicionIVAReceptorId") + 1);
      expect(keys.indexOf("Iva")).toBe(keys.indexOf("CbtesAsoc") + 1);
    });

    it("una nota de Factura A con servicios lleva el vencimiento, como la factura", () => {
      const d = detail(build({ arca_concept: 2, service_from: "2026-11-01", service_to: "2026-11-30", due_date: "2026-12-10" }));
      expect(d).toMatchObject({ Concepto: 2, FchServDesde: "20261101", FchServHasta: "20261130", FchVtoPago: "20261210" });
    });

    describe("notas de FCE (ARCA 10172, 10175, 10162 y 10154)", () => {
      const fceAssoc = original({ cbte_tipo: 201 });
      const fceNote = (over = {}) => detail(build({ cbte_tipo: 203, due_date: "2026-12-10", fce_transfer_option: "SCA", ...over }, fceAssoc));

      it("llevan el opcional 22 en 'N' y NO llevan CBU, alias, transferencia ni referencia comercial", () => {
        const d = fceNote();
        expect(d.Opcionales).toEqual({ Opcional: [{ Id: "22", Valor: "N" }] });
        expect(d.CbtesAsoc.CbteAsoc[0].Tipo).toBe(201);
      });

      it("con marca de anulación mandan 'S'", () => {
        expect(fceNote({ fce_annulment: true }).Opcionales.Opcional[0]).toEqual({ Id: "22", Valor: "S" });
      });

      it("no llevan el vencimiento de pago, ni siquiera con servicios", () => {
        expect(fceNote()).not.toHaveProperty("FchVtoPago");
        const withServices = fceNote({ arca_concept: 2, service_from: "2026-11-01", service_to: "2026-11-30" });
        expect(withServices).not.toHaveProperty("FchVtoPago");
        expect(withServices).toMatchObject({ FchServDesde: "20261101", FchServHasta: "20261130" });
      });

      it("el opcional va después del IVA, al final", () => {
        const keys = Object.keys(fceNote());
        expect(keys[keys.length - 1]).toBe("Opcionales");
        expect(keys.indexOf("Opcionales")).toBeGreaterThan(keys.indexOf("Iva"));
      });
    });

    it("una nota de débito se arma igual, con su tipo", () => {
      const req = build({ cbte_tipo: 2, kind: "debit_note" });
      expect(req.FeCAEReq.FeCabReq.CbteTipo).toBe(2);
      expect(detail(req).CbtesAsoc.CbteAsoc[0].Nro).toBe(7);
    });
  });

  it("explica los rechazos de las notas", () => {
    expect(explainRejection("(10197) falta", [10197], {})).toMatch(/necesita la factura original asociada/);
    expect(explainRejection("(10154) no rechazado", [10154], {})).toMatch(/sin marca de anulación/);
    expect(explainRejection("(10035) vto", [10035], {})).toMatch(/período facturado y el vencimiento/);
    expect(explainRejection("(10184) saldo", [10184], {})).toMatch(/saldo actual de su cuenta corriente/);
  });
});
