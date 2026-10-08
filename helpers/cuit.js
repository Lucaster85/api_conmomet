// CUIT/CUIL argentino: 11 dígitos, el último es verificador (módulo 11). Se guarda normalizado
// (solo dígitos) y se muestra como XX-XXXXXXXX-X. Reutilizable por la integración con ARCA.

const MULTIPLIERS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

// "30-12345678-1" / "30 12345678 1" -> "30123456781". Vacío -> null.
function normalizeCuit(value) {
  if (value === undefined || value === null) return null;
  const digits = String(value).replace(/[\s-]/g, "");
  return digits === "" ? null : digits;
}

function isValidCuit(value) {
  const digits = normalizeCuit(value);
  if (!digits || !/^\d{11}$/.test(digits)) return false;

  const sum = MULTIPLIERS.reduce((acc, m, i) => acc + m * Number(digits[i]), 0);
  const remainder = 11 - (sum % 11);
  // 10 no tiene dígito verificador posible: ARCA no emite CUITs que den 10.
  if (remainder === 10) return false;
  const expected = remainder === 11 ? 0 : remainder;
  return expected === Number(digits[10]);
}

function formatCuit(value) {
  const digits = normalizeCuit(value);
  if (!digits || digits.length !== 11) return digits;
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}

module.exports = { normalizeCuit, isValidCuit, formatCuit };
