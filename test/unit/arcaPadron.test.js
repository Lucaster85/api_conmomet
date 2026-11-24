"use strict";
// Mapeo de la respuesta del padrón A13 de ARCA (services/arca/padron.js, FLOWS.md §73). Sin red.
const { mapPersona } = require("../../services/arca/padron");

const company = {
  datosGenerales: {
    idPersona: 30716396653, tipoPersona: "JURIDICA", tipoClave: "CUIT", estadoClave: "ACTIVO", razonSocial: "CONMOMET  S.A.",
    domicilioFiscal: { direccion: "CALLE 578 1682", localidad: "QUEQUEN", codPostal: "7631", idProvincia: 1, descripcionProvincia: "BUENOS AIRES", tipoDomicilio: "FISCAL" },
  },
  datosRegimenGeneral: { impuesto: [{ idImpuesto: 30, descripcionImpuesto: "IVA", estadoImpuesto: "AC" }, { idImpuesto: 20, estadoImpuesto: "AC" }] },
};

describe("mapPersona", () => {
  it("una sociedad: razón social, domicilio fiscal y condición frente al IVA", () => {
    expect(mapPersona(company, "30-71639665-3")).toEqual({
      cuit: "30716396653", legal_name: "CONMOMET S.A.", person_type: "JURIDICA", status: "ACTIVO", tax_condition: "responsable_inscripto",
      fiscal_street: "CALLE 578 1682", fiscal_locality: "QUEQUEN", fiscal_province: "BUENOS AIRES", postal_code: "7631",
    });
  });

  it("una persona física sale 'Apellido Nombre' con mayúsculas prolijas; el monotributo se reconoce", () => {
    const r = mapPersona({
      datosGenerales: { idPersona: "20123456786", tipoPersona: "FISICA", apellido: "PÉREZ DE LA ROSA", nombre: "JUAN CARLOS", estadoClave: "ACTIVO", domicilioFiscal: {} },
      datosMonotributo: { impuesto: [] },
    }, "20123456786");
    expect(r).toMatchObject({ legal_name: "Pérez De La Rosa Juan Carlos", tax_condition: "monotributo", fiscal_street: null, fiscal_province: null });
  });

  it("no inventa la condición de IVA: sin monotributo ni IVA activo, no se sugiere nada", () => {
    expect(mapPersona({ datosGenerales: { ...company.datosGenerales }, datosRegimenGeneral: { impuesto: [{ idImpuesto: 30, estadoImpuesto: "BAJA" }] } }, "30716396653").tax_condition).toBeNull();
    expect(mapPersona({ datosGenerales: { ...company.datosGenerales } }, "30716396653").tax_condition).toBeNull();
  });

  it("acepta un solo impuesto (no lista) y los datos dentro de `persona`", () => {
    const r = mapPersona({ persona: { datosGenerales: company.datosGenerales }, datosRegimenGeneral: { impuesto: { idImpuesto: 30, estadoImpuesto: "AC" } } }, "30716396653");
    expect(r.tax_condition).toBe("responsable_inscripto");
  });

  it("si ARCA no encuentra el CUIT lo dice con el motivo que informa", () => {
    expect(() => mapPersona({ errorConstancia: { idPersona: 20000000001, error: ["No existe persona con ese Id"] } }, "20000000001")).toThrow(/no encontró el CUIT: No existe persona con ese Id/);
    expect(() => mapPersona(undefined, "20000000001")).toThrow(/no encontró el CUIT/);
  });

  it("recorta los textos largos a lo que admite el cliente y limpia espacios", () => {
    const r = mapPersona({ datosGenerales: { idPersona: 1, tipoPersona: "JURIDICA", razonSocial: "X", domicilioFiscal: { direccion: `  ${"A".repeat(300)}  `, localidad: " B  C " } } }, "30716396653");
    expect(r.fiscal_street).toHaveLength(150);
    expect(r.fiscal_locality).toBe("B C");
  });
});
