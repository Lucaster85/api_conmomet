// S2: el pedido crudo a ARCA lleva `Token` y `Sign` (con eso alcanza para emitir facturas 12 h). Se quitan antes de
// guardar nada (arca_result) o de loguear. Recursivo, sin mutar el original.
const SECRET_KEYS = new Set(["token", "sign", "auth", "cms", "in0"]);

function stripArcaSecrets(value) {
  if (Array.isArray(value)) return value.map(stripArcaSecrets);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (SECRET_KEYS.has(key.toLowerCase())) continue;
      out[key] = stripArcaSecrets(val);
    }
    return out;
  }
  return value;
}

module.exports = { stripArcaSecrets };
