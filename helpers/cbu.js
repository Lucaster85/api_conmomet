// CBU argentino: 22 dígitos = bloque 1 (banco 3 + sucursal 4 + dígito verificador 1) + bloque 2 (cuenta 13 + dígito
// verificador 1). Se guarda normalizado (solo dígitos). Se valida con los dos dígitos verificadores, no solo el largo:
// un CBU mal tipeado en una factura FCE es un cobro que no llega.

const BLOCK1_WEIGHTS = [7, 1, 3, 9, 7, 1, 3];
const BLOCK2_WEIGHTS = [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3];

// "0110 0599 2000 0001 2345 67" -> "0110059920000001234567". Vacío -> null.
function normalizeCbu(value) {
  if (value === undefined || value === null) return null;
  const digits = String(value).replace(/[\s-]/g, "");
  return digits === "" ? null : digits;
}

function checkDigit(digits, weights) {
  const sum = weights.reduce((acc, w, i) => acc + w * Number(digits[i]), 0);
  return (10 - (sum % 10)) % 10;
}

function isValidCbu(value) {
  const cbu = normalizeCbu(value);
  if (!cbu || !/^\d{22}$/.test(cbu)) return false;
  return (
    checkDigit(cbu.slice(0, 7), BLOCK1_WEIGHTS) === Number(cbu[7]) &&
    checkDigit(cbu.slice(8, 21), BLOCK2_WEIGHTS) === Number(cbu[21])
  );
}

// Alias de CBU: 6 a 20 caracteres, letras, números, punto y guion (sin espacios).
function isValidCbuAlias(value) {
  return typeof value === "string" && /^[A-Za-z0-9.-]{6,20}$/.test(value);
}

module.exports = { normalizeCbu, isValidCbu, isValidCbuAlias };
