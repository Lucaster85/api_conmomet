// Códigos de WSFEv1 / WSAA que usa la integración. Solo lo que el módulo emite (Factura A y FCE A, con sus NC/ND):
// B/C/E no se emiten por ARCA (PLAN_ARCA.md §2). Los códigos de los opcionales de la FCE NO van acá: se leen de
// FEParamGetTiposOpcional en la etapa 4 (§8, B12).

const ENVS = {
  homologacion: {
    wsaaWsdl: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms?WSDL",
    wsaaEndpoint: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
    wsfeWsdl: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL",
    wsfeEndpoint: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
  },
  produccion: {
    wsaaWsdl: "https://wsaa.afip.gov.ar/ws/services/LoginCms?WSDL",
    wsaaEndpoint: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
    wsfeWsdl: "https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL",
    wsfeEndpoint: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
  },
};

// Tipos de comprobante: 1/2/3 Factura, ND y NC A · 201/202/203 FCE A (factura, ND, NC).
const CBTE_TIPO = {
  FACTURA_A: 1,
  NOTA_DEBITO_A: 2,
  NOTA_CREDITO_A: 3,
  FCE_A_FACTURA: 201,
  FCE_A_NOTA_DEBITO: 202,
  FCE_A_NOTA_CREDITO: 203,
};

const CBTE_TIPO_LABELS = {
  1: "Factura A",
  2: "Nota de Débito A",
  3: "Nota de Crédito A",
  201: "Factura de Crédito Electrónica A",
  202: "Nota de Débito Electrónica A",
  203: "Nota de Crédito Electrónica A",
};

// Documento del receptor: 80 CUIT · 96 DNI · 99 consumidor final.
const DOC_TIPO = { CUIT: 80, DNI: 96, CONSUMIDOR_FINAL: 99 };

// Concepto: 1 productos · 2 servicios · 3 productos y servicios.
const CONCEPTO = { PRODUCTOS: 1, SERVICIOS: 2, PRODUCTOS_Y_SERVICIOS: 3 };

// Alícuotas de IVA (Id de WSFEv1 -> porcentaje).
const IVA_ID = { 10.5: 4, 21: 5 };

const SERVICE_WSFE = "wsfe";

module.exports = { ENVS, CBTE_TIPO, CBTE_TIPO_LABELS, DOC_TIPO, CONCEPTO, IVA_ID, SERVICE_WSFE };
