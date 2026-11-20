"use strict";
const { buildPdfModel, renderInvoicePdf, lineDescription, COPIES, TEST_WATERMARK, PREVIEW_WATERMARK, PREVIEW_MASK } = require("../../services/arca/invoicePdf");
const { parseQrUrl } = require("../../services/arca/qr");

const issuer = {
  legal_name: "CONMOMET S.A", display_name: null, cuit: "30716396653", vat_condition: "responsable_inscripto", iibb_number: "30716396653",
  activity_start_date: "2020-02-01", address: { street: "578 1682", number: null, locality: "Quequén", province: "Buenos Aires" },
};
const recipient = {
  legal_name: "BUNGE ARGENTINA S.A.", cuit: "30500000000", vat_condition: "IVA Responsable Inscripto", vat_condition_id: 1,
  address: { street: "Ruta 8 km 500", locality: "Tancacha", province: "Córdoba" },
};
const baseInvoice = (over = {}) => ({
  cbte_tipo: 1, pos_number: 3, number: 5, issue_date: "2026-11-17", due_date: "2026-12-17", currency: "ARS", exchange_rate: null,
  arca_concept: 1, service_from: null, service_to: null, recipient_doc_type: 80, recipient_doc_number: "30500000000",
  iva_rate: 21, net_amount: 1000, iva_amount: 210, total_amount: 1210, cae: "86461069911132", cae_expiration: "2026-11-27",
  arca_env: "homologacion", sale_condition: "Otra", remito_number: null, commercial_reference: "OC 4104017010",
  issuer_snapshot: issuer, recipient_snapshot: recipient,
  lines: [{ concept: "labor", percent: 100, net_amount: 1000, description: null }],
  ...over,
});

describe("arca invoicePdf — modelo", () => {
  it("arma los textos de una Factura A desde los datos congelados", () => {
    const model = buildPdfModel(baseInvoice(), { budget: { number: "PRES-2026-012", title: "Cañerías" } });
    expect(model).toMatchObject({
      title: "FACTURA", letter: "A", codeLabel: "COD. 01", pos: "0003", number: "00000005", issueDate: "17/11/2026",
      fileBase: "Factura-A-0003-00000005", cae: "86461069911132", caeExpiration: "27/11/2026", commercialReference: "OC 4104017010",
    });
    expect(model.issuer).toMatchObject({ displayName: "CONMOMET S.A", vat: "IVA Responsable Inscripto", address: "578 1682, Quequén, Buenos Aires", activityStart: "01/02/2020" });
    expect(model.recipient).toMatchObject({ cuit: "30-50000000-0", legalName: "BUNGE ARGENTINA S.A.", address: "Ruta 8 km 500, Tancacha, Córdoba", saleCondition: "Otra" });
    expect(model.totals).toEqual({ net: "1.000,00", ivaLabel: "IVA 21%", iva: "210,00", other: "0,00", total: "1.210,00" });
    expect(model.copies).toEqual(COPIES);
    expect(model.copies).toEqual(["ORIGINAL", "DUPLICADO", "TRIPLICADO"]);
  });

  it("la fila replica las columnas de ARCA: cantidad 1, 'otras unidades', bonificación 0 y subtotal con IVA solo visual", () => {
    const row = buildPdfModel(baseInvoice()).rows[0];
    expect(row).toMatchObject({ quantity: "1,00", unit: "otras unidades", unitPrice: "1.000,00", bonus: "0,00", subtotal: "1.000,00", iva: "21%", subtotalWithIva: "1.210,00" });
  });

  it("la descripción por defecto lleva el concepto, el porcentaje y el presupuesto; una cargada a mano manda", () => {
    const budget = { number: "PRES-2026-012", title: "Cañerías" };
    expect(lineDescription({ concept: "materials", percent: 30, description: null }, budget)).toBe("Se factura el 30% de materiales — PRES-2026-012 Cañerías");
    expect(lineDescription({ concept: "labor", percent: null, description: "  " }, null)).toBe("Se factura mano de obra");
    expect(lineDescription({ concept: "labor", percent: 30, description: "Se factura el 30% OC 4104017010" }, budget)).toBe("Se factura el 30% OC 4104017010");
  });

  it("una línea con su presupuesto y su OC los nombra (una factura puede cobrar varios)", () => {
    const line = { concept: "labor", percent: 40, description: null, budget: { number: "PRES-2026-020", title: "Montaje" }, purchaseOrder: { number: "117242" } };
    expect(lineDescription(line, { number: "PRES-2026-001", title: "Otro" })).toBe("Se factura el 40% de mano de obra — OC 117242 · PRES-2026-020 Montaje");
    expect(lineDescription({ concept: "materials", percent: 10, description: null, budget: { number: "PRES-2026-020", title: "Montaje" } }, null)).toBe("Se factura el 10% de materiales — PRES-2026-020 Montaje");
  });

  it("con servicios muestra el período facturado y el vencimiento; con productos no", () => {
    expect(buildPdfModel(baseInvoice()).period).toBeNull();
    const services = buildPdfModel(baseInvoice({ arca_concept: 2, service_from: "2026-11-01", service_to: "2026-11-30" }));
    expect(services.period).toEqual({ from: "01/11/2026", to: "30/11/2026", due: "17/12/2026" });
  });

  it("en dólares marca la moneda, el tipo de cambio y la leyenda con el total en pesos", () => {
    const model = buildPdfModel(baseInvoice({ currency: "USD", exchange_rate: 1480, total_amount: 1210 }));
    expect(model.currencyLine).toBe("Moneda: USD – Dólar Estadounidense    Tipo de cambio: 1.480,000000");
    expect(model.amountSuffix).toBe(" (USD)");
    expect(model.pesosLegend).toBe("Total expresado en pesos considerando un tipo de cambio de 1.480,000000 asciende a $ 1.790.800,00");
    expect(buildPdfModel(baseInvoice()).pesosLegend).toBeNull();
  });

  it("homologación lleva la marca de prueba (S4); producción no", () => {
    expect(buildPdfModel(baseInvoice()).isTest).toBe(true);
    expect(buildPdfModel(baseInvoice()).watermark).toBe(TEST_WATERMARK);
    expect(buildPdfModel(baseInvoice({ arca_env: "produccion" })).isTest).toBe(false);
  });

  it("el QR del modelo es el del comprobante, con el CUIT del EMISOR congelado", () => {
    const qr = parseQrUrl(buildPdfModel(baseInvoice()).qrUrl);
    expect(qr).toMatchObject({ cuit: 30716396653, ptoVta: 3, tipoCmp: 1, nroCmp: 5, importe: 1210, nroDocRec: 30500000000, codAut: 86461069911132 });
  });

  it("usa el nombre y código de una FCE", () => {
    const model = buildPdfModel(baseInvoice({ cbte_tipo: 201 }));
    expect(model).toMatchObject({ title: "FACTURA DE CRÉDITO ELECTRÓNICA", codeLabel: "COD. 201" });
    expect(model.fileBase).toMatch(/^Factura-de-Crédito-Electrónica-A-0003-00000005$/);
  });

  describe("FCE", () => {
    const fce = (over = {}) => baseInvoice({
      cbte_tipo: 201, fce_transfer_option: "SCA", due_date: "2026-12-17",
      issuer_snapshot: { ...issuer, bank: { bank_name: "Banco X", cbu: "0170099220000067797370", alias: "CONMOMET.COBROS" } },
      ...over,
    });

    it("suma el bloque de la FCE: CBU y alias congelados, opción de transferencia, aviso legal y subtítulo", () => {
      const model = buildPdfModel(fce());
      expect(model).toMatchObject({ title: "FACTURA DE CRÉDITO ELECTRÓNICA", subtitle: "MiPyMEs (FCE)", codeLabel: "COD. 201" });
      expect(model.fce.cbu).toBe("0170099220000067797370");
      expect(model.fce.alias).toBe("CONMOMET.COBROS");
      expect(model.fce.transferText).toMatch(/^Opción de Transferencia: Sistema de Circulacion Abierta "Luego de su aceptación tácita o expresa/);
      expect(model.fce.legalNotice).toMatch(/21 días corridos/);
      expect(model.fce.legalNotice).toMatch(/artículo 523 del Código Procesal Civil y Comercial/);
    });

    it("la opción ADC se imprime con su nombre", () => {
      expect(buildPdfModel(fce({ fce_transfer_option: "ADC" })).fce.transferText).toBe("Opción de Transferencia: Agente de Depósito Colectivo");
    });

    it("muestra siempre el vencimiento de pago, aunque el concepto sea solo productos; con servicios, también el período", () => {
      expect(buildPdfModel(fce()).period).toEqual({ from: null, to: null, due: "17/12/2026" });
      expect(buildPdfModel(fce({ arca_concept: 2, service_from: "2026-11-01", service_to: "2026-11-30" })).period)
        .toEqual({ from: "01/11/2026", to: "30/11/2026", due: "17/12/2026" });
    });

    it("una Factura A no tiene bloque de FCE ni subtítulo", () => {
      const model = buildPdfModel(baseInvoice());
      expect(model.fce).toBeNull();
      expect(model.subtitle).toBe("");
    });

    it("se dibuja en tres hojas", async () => {
      const buffer = await renderInvoicePdf(buildPdfModel(fce()));
      expect((buffer.toString("latin1").match(/\/Type \/Page\b/g) || []).length).toBe(3);
    });
  });

  describe("notas de crédito y de débito", () => {
    const associated = { cbte_tipo: 1, pos_number: 3, number: 7, issue_date: "2026-11-10" };
    const note = (over = {}) => baseInvoice({ cbte_tipo: 3, kind: "credit_note", ...over });

    it("muestra el comprobante asociado y el título de nota de crédito", () => {
      const model = buildPdfModel(note(), { associated });
      expect(model).toMatchObject({ title: "NOTA DE CRÉDITO", codeLabel: "COD. 03", fileBase: "Nota-de-Crédito-A-0003-00000005" });
      expect(model.associated).toEqual({ label: "Factura A 0003-00000007", date: "10/11/2026" });
    });

    it("la descripción por defecto de una nota de crédito dice qué se acredita y sobre qué factura", () => {
      const model = buildPdfModel(note({ lines: [{ concept: "labor", percent: 50, net_amount: 500, description: null }] }), { associated });
      expect(model.rows[0].description).toBe("Se acredita el 50% de mano de obra s/ Factura A 0003-00000007");
    });

    it("una descripción cargada manda; la de una nota de débito cae a 'Nota de débito s/ factura'", () => {
      expect(buildPdfModel(note({ lines: [{ concept: "labor", percent: 50, net_amount: 500, description: "Devolución parcial" }] }), { associated }).rows[0].description).toBe("Devolución parcial");
      const debit = buildPdfModel(baseInvoice({ cbte_tipo: 2, kind: "debit_note", lines: [{ concept: "other", percent: null, net_amount: 100, description: null }] }), { associated });
      expect(debit.title).toBe("NOTA DE DÉBITO");
      expect(debit.rows[0].description).toBe("Nota de débito s/ Factura A 0003-00000007");
    });

    it("una nota de FCE (203) no lleva el bloque de la FCE ni el vencimiento: ARCA no se los pide", () => {
      const fceNote = buildPdfModel(note({ cbte_tipo: 203, due_date: "2026-12-17", issuer_snapshot: { ...issuer, bank: { cbu: "0170099220000067797370" } } }), { associated: { ...associated, cbte_tipo: 201 } });
      expect(fceNote.fce).toBeNull();
      expect(fceNote.period).toBeNull();
      expect(fceNote.subtitle).toBe("");
      expect(fceNote.title).toBe("NOTA DE CRÉDITO ELECTRÓNICA");
      expect(fceNote.associated.label).toBe("Factura de Crédito Electrónica A 0003-00000007");
    });

    it("una factura común no tiene comprobante asociado", () => {
      expect(buildPdfModel(baseInvoice()).associated).toBeNull();
    });

    it("se dibuja en tres hojas", async () => {
      const buffer = await renderInvoicePdf(buildPdfModel(note(), { associated }));
      expect((buffer.toString("latin1").match(/\/Type \/Page\b/g) || []).length).toBe(3);
    });
  });

  it("no genera el PDF de una factura sin CAE o sin datos congelados", () => {
    expect(() => buildPdfModel(baseInvoice({ cae: null }))).toThrow(/no está autorizada/);
    expect(() => buildPdfModel(baseInvoice({ issuer_snapshot: null }))).toThrow(/no está autorizada/);
    expect(() => buildPdfModel(baseInvoice({ number: null }))).toThrow(/no está autorizada/);
  });
});

describe("arca invoicePdf — render", () => {
  const pagesOf = (buffer) => (buffer.toString("latin1").match(/\/Type \/Page\b/g) || []).length;

  it("genera un PDF válido de tres hojas (original, duplicado y triplicado)", async () => {
    const buffer = await renderInvoicePdf(buildPdfModel(baseInvoice()));
    expect(buffer.slice(0, 5).toString()).toBe("%PDF-");
    expect(buffer.slice(-6).toString()).toContain("%%EOF");
    expect(pagesOf(buffer)).toBe(3);
  });

  it("una factura con muchas líneas sigue en más hojas dentro de cada copia, sin cortarse", async () => {
    const lines = Array.from({ length: 40 }, (_, i) => ({ concept: "other", percent: null, net_amount: 100, description: `Línea de prueba número ${i + 1} con una descripción un poco larga para ocupar espacio` }));
    const buffer = await renderInvoicePdf(buildPdfModel(baseInvoice({ lines, net_amount: 4000, iva_amount: 840, total_amount: 4840 })));
    expect(pagesOf(buffer)).toBeGreaterThan(3);
    expect(pagesOf(buffer) % 3).toBe(0);
  });

  it("tolera textos con acentos, ñ y comillas", async () => {
    const buffer = await renderInvoicePdf(buildPdfModel(baseInvoice({ lines: [{ concept: "other", net_amount: 1000, description: "Reparación de cañerías “Ñandú” – 100% (año 2026)" }] })));
    expect(buffer.length).toBeGreaterThan(2000);
  });
});

describe("arca invoicePdf — vista previa de un borrador", () => {
  const draft = () => baseInvoice({ number: null, cae: null, cae_expiration: null, arca_env: null });

  it("sin número ni CAE no falla: lo que asigna ARCA sale con asteriscos y el resto es real", () => {
    const model = buildPdfModel(draft(), { preview: true });
    expect(model).toMatchObject({
      isPreview: true, isTest: false, watermark: PREVIEW_WATERMARK, pos: "0003", number: PREVIEW_MASK.number,
      cae: PREVIEW_MASK.cae, caeExpiration: PREVIEW_MASK.caeExpiration, qrUrl: null, issueDate: "17/11/2026",
    });
    expect(model.totals.total).toBe("1.210,00");
    expect(model.recipient.legalName).toBe("BUNGE ARGENTINA S.A.");
    expect(model.copies).toEqual(["ORIGINAL"]);
    expect(model.fileBase).toBe("Vista-previa-Factura-A");
  });

  it("sin la opción preview, un borrador sigue sin poder armarse (no se confunde con el PDF final)", () => {
    expect(() => buildPdfModel(draft())).toThrow(/no está autorizada/);
  });

  it("renderiza un PDF válido de una sola hoja, sin QR", async () => {
    const pdf = await renderInvoicePdf(buildPdfModel(draft(), { preview: true }), { compress: false });
    const text = pdf.toString("latin1");
    expect(text.startsWith("%PDF")).toBe(true);
    expect((text.match(/\/Type \/Page\b/g) || []).length).toBe(1);
    expect(text).not.toMatch(/\/Subtype \/Image/);
  });
});
