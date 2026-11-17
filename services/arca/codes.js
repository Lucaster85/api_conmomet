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
  6: "Factura B", 7: "Nota de Débito B", 8: "Nota de Crédito B",
  11: "Factura C", 12: "Nota de Débito C", 13: "Nota de Crédito C",
  19: "Factura E", 20: "Nota de Débito E", 21: "Nota de Crédito E",
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

// Alícuotas de IVA: porcentaje -> Id de WSFEv1 (FEParamGetTiposIva).
const IVA_ID = { 0: 3, 10.5: 4, 21: 5, 27: 6, 5: 8, 2.5: 9 };

// CondicionIVAReceptorId válidos para comprobantes clase A (FEParamGetCondicionIvaReceptor con ClaseCmp=A, verificado en
// homologación el 16/11/2026): 1 Responsable Inscripto, 6 Responsable Monotributo, 13 Monotributista Social, 16 Monotributo
// Trabajador Independiente Promovido. El IVA Exento (4) y el Consumidor Final (5) NO pueden recibir una Factura A.
const RECEIVER_VAT_CONDITIONS_CLASS_A = { 1: "IVA Responsable Inscripto", 6: "Responsable Monotributo", 13: "Monotributista Social", 16: "Monotributo Trabajador Independiente Promovido" };

// Condición frente al IVA del cliente en la app -> CondicionIVAReceptorId de ARCA (solo las que admiten Factura A).
const CLIENT_TAX_CONDITION_TO_ARCA = { responsable_inscripto: 1, monotributo: 6 };

const SERVICE_WSFE = "wsfe";

module.exports = {
  ENVS, CBTE_TIPO, CBTE_TIPO_LABELS, DOC_TIPO, CONCEPTO, IVA_ID, SERVICE_WSFE,
  RECEIVER_VAT_CONDITIONS_CLASS_A, CLIENT_TAX_CONDITION_TO_ARCA,
};
