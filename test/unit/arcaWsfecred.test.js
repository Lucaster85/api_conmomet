"use strict";
// Mapeo y paginado de wsfecred (services/arca/wsfecred.js, FLOWS.md §77). Sin red: las respuestas están armadas según el WSDL público de ARCA (V 2.0.3).
jest.mock("../../services/arca/wsaa", () => ({ getAuth: jest.fn() }));
jest.mock("../../services/arca/soapClient", () => ({ getSoapClient: jest.fn(), toArcaError: jest.fn((e) => e) }));
jest.mock("../../services/arca/credentials", () => ({ getArcaConfig: jest.fn(() => ({ enabled: true, env: "homologacion", cuit: "20123456786" })) }));

const wsaa = require("../../services/arca/wsaa");
const { getSoapClient } = require("../../services/arca/soapClient");
const w = require("../../services/arca/wsfecred");
const { ArcaError } = require("../../services/arca/errors");

const comprobante = (over = {}) => ({
  cuitEmisor: 20123456786, razonSocialEmi: "CONMOMET", codTipoCmp: 201, ptovta: 3, nroCmp: 5, cuitReceptor: 30716396653, razonSocialRecep: "BUNGE",
  fechaEmision: "2026-11-10", fechaPuestaDispo: "2026-11-11", fechaVenPago: "2026-12-10", fechaVenAcep: "2026-11-21", importeTotal: 121000, codMoneda: "PES",
  CBUEmisor: "0170099220000067797370", AliasEmisor: "CONMOMET.COBROS", codCtaCte: 1200, estado: { estado: "Recepcionado", fechaHoraEstado: "2026-11-12T10:00:00-03:00" },
  arrayItems: { item: [{ descripcion: "x" }] }, datosGenerales: "texto largo", opcionTransferencia: "ADC", ...over,
});

describe("mapComprobante", () => {
  it("empareja por tipo, punto de venta y número, y trae estado, fechas y opción de transferencia", () => {
    const r = w.mapComprobante(comprobante());
    expect(r).toMatchObject({
      cbte_tipo: 201, pos_number: 3, number: 5, recipient_cuit: "30716396653", cmp_state: "Recepcionado", account_code: 1200,
      available_at: "2026-11-11", acceptance_due: "2026-11-21", payment_due: "2026-12-10", transfer_option: "ADC", total: 121000, currency: "PES",
      acceptance_type: null, accepted_at: null, rejection_reasons: [],
    });
    expect(r.cmp_state_at).toBeInstanceOf(Date);
  });

  it("una aceptación tácita trae el tipo y la fecha; un rechazo trae sus motivos", () => {
    const accepted = w.mapComprobante(comprobante({ estado: { estado: "Aceptado", fechaHoraEstado: "2026-11-22T00:00:00-03:00" }, tipoAcep: "Tacita", fechaHoraAcep: "2026-11-22T00:00:00-03:00" }));
    expect(accepted).toMatchObject({ cmp_state: "Aceptado", acceptance_type: "Tacita" });
    expect(accepted.accepted_at).toBeInstanceOf(Date);

    const one = w.mapComprobante(comprobante({ estado: { estado: "Rechazado" }, arrayMotivosRechazo: { motivoRechazo: { codMotivo: 3, descMotivo: "Importe erróneo", justificacion: "No coincide con la OC" } } }));
    expect(one.rejection_reasons).toEqual([{ code: 3, description: "Importe erróneo", justification: "No coincide con la OC" }]);
    const two = w.mapComprobante(comprobante({ arrayMotivosRechazo: { motivoRechazo: [{ codMotivo: 1, descMotivo: "a", justificacion: "b" }, { codMotivo: 2, descMotivo: "c", justificacion: "d" }] } }));
    expect(two.rejection_reasons).toHaveLength(2);
  });

  it("un campo que falta queda en null y un estado desconocido no se inventa", () => {
    const r = w.mapComprobante({ codTipoCmp: 202, ptovta: 3, nroCmp: 9, estado: { estado: "EstadoNuevoDeArca" } });
    expect(r).toMatchObject({ cbte_tipo: 202, cmp_state: null, account_code: null, available_at: null, acceptance_due: null, transfer_option: null, total: null, associated: null, is_annulment: null });
    expect(w.mapComprobante(null).cbte_tipo).toBeNull();
  });

  it("de una nota trae la factura asociada y si es anulación", () => {
    const r = w.mapComprobante(comprobante({ codTipoCmp: 203, esAnulacion: "S", idComprobanteAsociado: { CUITEmisor: 20123456786, codTipoCmp: 201, ptoVta: 3, nroCmp: 5 } }));
    expect(r).toMatchObject({ is_annulment: true, associated: { cbte_tipo: 201, pos_number: 3, number: 5 } });
  });

  it("el resumen guardado enmascara el CBU y no arrastra renglones ni textos largos", () => {
    const { snapshot } = w.mapComprobante(comprobante());
    expect(snapshot.CBUEmisor).toBe("******************7370");
    expect(snapshot.CBUEmisor).not.toContain("0170099220");
    expect(snapshot).not.toHaveProperty("arrayItems");
    expect(snapshot).not.toHaveProperty("datosGenerales");
    expect(snapshot.codCtaCte).toBe(1200);
    expect(() => JSON.stringify(snapshot)).not.toThrow();
  });
});

describe("mapCtaCte y mapHistory", () => {
  it("la cuenta corriente trae estado, saldo y saldo aceptado, y la factura que la originó", () => {
    const r = w.mapCtaCte({
      codCtaCte: 1200, estadoCtaCte: { estado: "Aceptada", fechaHoraEstado: "2026-11-22T00:00:00-03:00" },
      idFacturaCredito: { CUITEmisor: 20123456786, codTipoCmp: 201, ptoVta: 3, nroCmp: 5 }, importeTotalFC: 121000, saldo: 100000.5, saldoAceptado: 100000.5, codMoneda: "PES", opcionTransferencia: "SCA",
    });
    expect(r).toMatchObject({ account_code: 1200, account_state: "Aceptada", cbte_tipo: 201, pos_number: 3, number: 5, balance: 100000.5, accepted_balance: 100000.5, transfer_option: "SCA" });
  });

  it("sin saldo aceptado queda en null (no en cero)", () => {
    expect(w.mapCtaCte({ codCtaCte: 1, estadoCtaCte: { estado: "Modificable" }, saldo: 10 }).accepted_balance).toBeNull();
  });

  it("el historial acepta un solo estado o una lista", () => {
    expect(w.mapHistory({ arrayHistorialEstados: { estadoHistorico: { estado: "Recepcionado", fechaHoraEstado: "2026-11-12T10:00:00Z" } } })).toHaveLength(1);
    expect(w.mapHistory({ arrayHistorialEstados: { estadoHistorico: [{ estado: "PendienteRecepcion" }, { estado: "Recepcionado" }] } }).map((e) => e.state)).toEqual(["PendienteRecepcion", "Recepcionado"]);
    expect(w.mapHistory({})).toEqual([]);
  });
});

describe("dateOnly", () => {
  it("se queda con AAAA-MM-DD venga como texto, con zona o como Date", () => {
    expect(w.dateOnly("2026-11-20")).toBe("2026-11-20");
    expect(w.dateOnly("2026-11-20-03:00")).toBe("2026-11-20");
    expect(w.dateOnly(new Date("2026-11-20T12:00:00Z"))).toBe("2026-11-20");
    expect(w.dateOnly(null)).toBeNull();
    expect(w.dateOnly("basura")).toBeNull();
  });
});

describe("throwIfErrors", () => {
  it("la observación 32767 (sin resultados) no es un error", () => {
    expect(() => w.throwIfErrors({ arrayObservaciones: { codigoDescripcion: { codigo: 32767, descripcion: "La búsqueda no ha arrojado resultados" } } }, "ctx")).not.toThrow();
  });

  it("los errores de negocio y de formato se informan con su código", () => {
    expect(() => w.throwIfErrors({ arrayErrores: { codigoDescripcion: [{ codigo: 1100, descripcion: "No autorizado" }] } }, "No se pudo")).toThrow(/No se pudo: \(1100\) No autorizado/);
    expect(() => w.throwIfErrors({ arrayErroresFormato: { codigoDescripcionString: { codigo: "cvc-x", descripcion: "mal" } } }, "ctx")).toThrow(ArcaError);
  });
});

describe("consultarComprobantes", () => {
  let client;
  beforeEach(() => {
    jest.clearAllMocks();
    wsaa.getAuth.mockResolvedValue({ token: "T", sign: "S", cuit: "20123456786" });
    client = { consultarComprobantesAsync: jest.fn(), consultarCtasCtesAsync: jest.fn() };
    getSoapClient.mockResolvedValue(client);
  });
  const page = (comprobantes, hayMas) => [{ consultarCmpReturn: { arrayComprobantes: { comprobante: comprobantes }, hayMas, nroPagina: 1 } }];

  it("pide como Emisor con el rango de fechas y recorre las páginas mientras hayMas sea 'S'", async () => {
    client.consultarComprobantesAsync
      .mockResolvedValueOnce(page([comprobante({ nroCmp: 1 }), comprobante({ nroCmp: 2 })], "S"))
      .mockResolvedValueOnce(page(comprobante({ nroCmp: 3 }), "N"));
    const r = await w.consultarComprobantes({ fecha: { tipo: "Emision", desde: "2026-11-01", hasta: "2026-11-20" } });
    expect(r.items.map((c) => c.number)).toEqual([1, 2, 3]);
    expect(r.truncated).toBe(false);
    expect(client.consultarComprobantesAsync).toHaveBeenCalledTimes(2);
    expect(client.consultarComprobantesAsync.mock.calls[0][0]).toMatchObject({
      authRequest: { token: "T", sign: "S", cuitRepresentada: "20123456786" }, rolCUITRepresentada: "Emisor", fecha: { tipo: "Emision", desde: "2026-11-01", hasta: "2026-11-20" }, nroPagina: 1,
    });
    expect(client.consultarComprobantesAsync.mock.calls[1][0].nroPagina).toBe(2);
  });

  it("sin resultados (32767) devuelve una lista vacía", async () => {
    client.consultarComprobantesAsync.mockResolvedValue([{ consultarCmpReturn: { arrayObservaciones: { codigoDescripcion: { codigo: 32767, descripcion: "sin resultados" } }, hayMas: "N" } }]);
    expect(await w.consultarComprobantes({})).toEqual({ items: [], truncated: false });
  });

  it("si se alcanza el tope de páginas lo informa en vez de cortar callado", async () => {
    client.consultarComprobantesAsync.mockResolvedValue(page([comprobante()], "S"));
    const r = await w.consultarComprobantes({});
    expect(client.consultarComprobantesAsync).toHaveBeenCalledTimes(w.MAX_PAGES);
    expect(r.truncated).toBe(true);
  });

  it("un error de negocio de ARCA corta con un ArcaError legible", async () => {
    client.consultarComprobantesAsync.mockResolvedValue([{ consultarCmpReturn: { arrayErrores: { codigoDescripcion: { codigo: 1101, descripcion: "CUIT no autorizado" } } } }]);
    await expect(w.consultarComprobantes({})).rejects.toThrow(/\(1101\) CUIT no autorizado/);
  });

  it("si wsfecred no está autorizado para el certificado, el mensaje dice qué autorizar", async () => {
    wsaa.getAuth.mockRejectedValue(new ArcaError("afip", "El CEE no posee autorización para el servicio wsfecred."));
    await expect(w.consultarComprobantes({})).rejects.toThrow(/Administrador de Relaciones/);
  });
});
