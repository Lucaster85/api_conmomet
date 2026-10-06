const ExcelJS = require("exceljs");

/**
 * Parser único de la planilla de materiales — lo usan el import del catálogo
 * (materialController.importPreview) y el del presupuesto (budgetController.importMaterials),
 * que antes tenían cada uno su copia y ya se habían desincronizado.
 *
 * Es "stateless": solo devuelve filas normalizadas, no persiste nada.
 */

const normalizeKey = (key) => String(key)
  .trim()
  .toLowerCase()
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
  .replace(/\s+/g, " ");

// "cost" es a propósito, no "unit_price": esta columna es el costo real del material (lo que
// sale comprarlo), nunca lo que se le cobra al cliente — ver FLOWS.md.
const COLUMN_ALIASES = {
  description: ["material", "descripcion", "detalle", "item", "producto"],
  quantity: ["cantidad", "cant", "qty"],
  unit: ["unidad", "u", "um"],
  provider: ["proveedor", "provider"],
  cost: ["costo", "costo unitario", "precio", "precio costo", "precio unitario", "precio por cantidad", "precio unit", "pu", "cost"],
  currency: ["moneda", "currency"],
  kg_per_meter: ["kg x ml", "kg/ml", "kg x m", "kg/m", "kg por metro", "kgxml", "kg x metro"],
  total_price: ["precio total", "total", "importe"],
};

// Celdas con fórmula ({ formula, result }), texto enriquecido ({ richText }) o hipervínculo
// ({ text, hyperlink }) llegan como objetos — se desenvuelven al valor visible.
function unwrapCell(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    if ("result" in value) return unwrapCell(value.result);
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("");
    if ("text" in value) return unwrapCell(value.text);
    return null;
  }
  return value;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return isNaN(value) ? null : value;
  let str = String(value).trim().replace(/\s/g, "").replace(/^\$/, "");
  if (!str) return null;
  // "1.234,56" → 1234.56 ; "12,5" → 12.5
  if (str.includes(",")) str = str.replace(/\./g, "").replace(",", ".");
  const parsed = parseFloat(str);
  return isNaN(parsed) ? null : parsed;
}

// Precio / kg vacíos o en 0 significan "sin dato".
const positiveOrNull = (value) => {
  const n = toNumber(value);
  return n !== null && n > 0 ? n : null;
};

/**
 * Lee el buffer y devuelve filas { description, quantity, unit, provider, cost, currency,
 * kg_per_meter, total_price }. quantity es 0 si falta; cost/kg_per_meter/total_price son null
 * si faltan o valen 0 (total_price cae a quantity * cost cuando hay costo).
 */
async function parseMaterialSheet(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  // Se busca la hoja "Materiales" por nombre, no por posición: herramientas como Numbers
  // agregan una hoja "Export Summary" primera al exportar a .xlsx, y tomar worksheets[0]
  // a ciegas terminaba leyendo esa hoja en vez de los datos reales.
  const worksheet = workbook.worksheets.find(
    (ws) => ws.name.trim().toLowerCase() === "materiales"
  ) || workbook.worksheets[0];
  if (!worksheet) {
    const err = new Error("El archivo no tiene hojas.");
    err.status = 400;
    throw err;
  }

  const headers = [];
  worksheet.getRow(1).eachCell((cell, colNumber) => {
    const value = unwrapCell(cell.value);
    headers[colNumber] = value !== null ? normalizeKey(value) : "";
  });

  const rows = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const normalizedRow = {};
    row.eachCell((cell, colNumber) => {
      if (headers[colNumber]) normalizedRow[headers[colNumber]] = unwrapCell(cell.value);
    });

    const findValue = (aliases) => {
      for (const alias of aliases) {
        if (normalizedRow[alias] !== undefined && normalizedRow[alias] !== null && normalizedRow[alias] !== "") {
          return normalizedRow[alias];
        }
      }
      return null;
    };

    const description = String(findValue(COLUMN_ALIASES.description) ?? "").trim();
    if (!description) return;

    const quantity = toNumber(findValue(COLUMN_ALIASES.quantity)) || 0;
    const cost = positiveOrNull(findValue(COLUMN_ALIASES.cost));
    const totalRaw = toNumber(findValue(COLUMN_ALIASES.total_price));
    const currencyRaw = String(findValue(COLUMN_ALIASES.currency) ?? "").trim().toUpperCase();

    rows.push({
      description,
      quantity,
      unit: String(findValue(COLUMN_ALIASES.unit) ?? "").trim() || "u",
      provider: String(findValue(COLUMN_ALIASES.provider) ?? "").trim(),
      cost,
      currency: ["ARS", "USD"].includes(currencyRaw) ? currencyRaw : null,
      kg_per_meter: positiveOrNull(findValue(COLUMN_ALIASES.kg_per_meter)),
      total_price: totalRaw !== null ? totalRaw : (cost !== null ? quantity * cost : null),
    });
  });

  return rows;
}

module.exports = { parseMaterialSheet };
