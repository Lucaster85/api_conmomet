"use strict";
const { phoneKey } = require("../../helpers/phone");

describe("phoneKey", () => {
  it("da la misma clave para las formas habituales de escribir un celular argentino", () => {
    const variants = [
      "2262 456789",
      "(2262) 45-6789",
      "02262 456789",
      "+54 9 2262 456789",
      "549 2262 456789",
      "2262.456789",
    ];
    const keys = variants.map(phoneKey);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe("2262456789");
  });

  it("distingue números distintos", () => {
    expect(phoneKey("2262 456789")).not.toBe(phoneKey("2262 456780"));
  });

  it("usa el número completo si no tiene característica", () => {
    expect(phoneKey("456789 12")).toBe("45678912");
  });

  it("devuelve null con menos de 8 dígitos o sin valor", () => {
    expect(phoneKey("1234567")).toBeNull();
    expect(phoneKey("")).toBeNull();
    expect(phoneKey(null)).toBeNull();
    expect(phoneKey(undefined)).toBeNull();
    expect(phoneKey("sin teléfono")).toBeNull();
  });
});
