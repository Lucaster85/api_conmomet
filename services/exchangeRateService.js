/**
 * Cotización del dólar para descontar cuotas de préstamos en USD en la liquidación.
 *
 * Fuente: familia argentinadatos/dolarapi (sin API key). La histórica tiene el valor definitivo
 * de cada quincena; la del día es solo una sugerencia provisoria (ver payrollController#generate
 * y payPeriodController#close). Base URLs por env var para poder mockear en tests o cambiar de
 * proveedor sin tocar código.
 *
 * Ninguna función de acá lanza: ante timeout, 404 (fecha futura todavía no publicada), status
 * distinto de 200 o payload sin el campo numérico esperado, devuelven null. El caller decide qué
 * hacer con un null (pedir carga manual, usar la provisoria, etc.) — nunca es un error a loguear.
 */

const FETCH_TIMEOUT_MS = 5000;

const HISTORY_BASE_URL = process.env.DOLAR_HISTORY_API_URL || "https://api.argentinadatos.com/v1/cotizaciones/dolares";
const CURRENT_BASE_URL = process.env.DOLAR_API_URL || "https://dolarapi.com/v1/dolares";

/**
 * La cotización que corresponde a una quincena es la del día siguiente a su cierre
 * (`end_date + 1`). Determinística: no depende de cuándo se genera o se cierra la liquidación.
 * Única fuente de verdad de esta regla — todo lo demás la consume.
 * @param {{ end_date: string|Date }} period
 * @returns {string} YYYY-MM-DD
 */
function rateDateForPeriod(period) {
  const endDate = typeof period.end_date === "string" ? period.end_date : period.end_date.toISOString().slice(0, 10);
  const [year, month, day] = endDate.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return [
    next.getUTCFullYear(),
    String(next.getUTCMonth() + 1).padStart(2, "0"),
    String(next.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function padDateParts(dateStr) {
  const [year, month, day] = dateStr.split("-");
  return { year, month: String(month).padStart(2, "0"), day: String(day).padStart(2, "0") };
}

function pickRate(payload, side) {
  const rate = side === "compra" ? payload?.compra : payload?.venta;
  return Number.isFinite(Number(rate)) && Number(rate) > 0 ? Number(rate) : null;
}

async function fetchJson(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) return null; // incluye el 404 esperado de una fecha todavía no publicada
    return await response.json();
  } catch {
    return null; // timeout, red caída, JSON inválido, etc.
  }
}

/**
 * Cotización histórica (definitiva) de una fecha puntual.
 * @param {string} dateStr - YYYY-MM-DD. El mes y el día se normalizan con cero a la izquierda:
 *   sin eso, la API devuelve 404 para cualquier fecha de un dígito.
 * @param {{ casa: string, side: 'venta'|'compra' }} config
 * @returns {Promise<{ rate: number, date: string, casa: string, side: string } | null>}
 */
async function fetchUsdRateForDate(dateStr, { casa, side }) {
  const { year, month, day } = padDateParts(dateStr);
  const url = `${HISTORY_BASE_URL}/${casa}/${year}/${month}/${day}`;
  const payload = await fetchJson(url);
  const rate = pickRate(payload, side);
  if (rate === null) return null;
  return { rate, date: `${year}-${month}-${day}`, casa, side };
}

/**
 * Cotización del día (sugerencia al otorgar, y provisoria cuando la definitiva todavía no se
 * publicó).
 * @param {{ casa: string, side: 'venta'|'compra' }} config
 * @returns {Promise<{ rate: number, fetched_at: string, casa: string, side: string } | null>}
 */
async function fetchCurrentUsdRate({ casa, side }) {
  const url = `${CURRENT_BASE_URL}/${casa}`;
  const payload = await fetchJson(url);
  const rate = pickRate(payload, side);
  if (rate === null) return null;
  return { rate, fetched_at: payload.fechaActualizacion || new Date().toISOString(), casa, side };
}

module.exports = { rateDateForPeriod, fetchUsdRateForDate, fetchCurrentUsdRate };
