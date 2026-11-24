"use strict";
const { normalizeCbu, isValidCbu, isValidCbuAlias } = require("../../helpers/cbu");

// CBU de ejemplo con los dos dígitos verificadores correctos.
const VALID = "0170099220000067797370";

describe("cbu", () => {
  it("acepta un CBU con dígitos verificadores correctos, con o sin separadores", () => {
    expect(isValidCbu(VALID)).toBe(true);
    expect(isValidCbu("01700992 2000006779737 0")).toBe(true);
    expect(normalizeCbu("0170 0992-2000 0067 7973 70")).toBe(VALID);
  });

  it("rechaza un CBU con un dígito cambiado en cada bloque", () => {
    expect(isValidCbu("0170099320000067797370")).toBe(false); // bloque 1 (banco/sucursal)
    expect(isValidCbu("0170099220000067797380")).toBe(false); // bloque 2 (cuenta)
  });

  it("rechaza largo incorrecto, letras y vacío", () => {
    expect(isValidCbu("017009922000006779737")).toBe(false);
    expect(isValidCbu("01700992200000677973701")).toBe(false);
    expect(isValidCbu("017009922000006779737A")).toBe(false);
    expect(isValidCbu("")).toBe(false);
    expect(isValidCbu(null)).toBe(false);
  });

  it("valida el alias: 6 a 20 caracteres, sin espacios", () => {
    expect(isValidCbuAlias("conmomet.cobros")).toBe(true);
    expect(isValidCbuAlias("corto")).toBe(false);
    expect(isValidCbuAlias("tiene espacio ok")).toBe(false);
    expect(isValidCbuAlias("a".repeat(21))).toBe(false);
  });
});
