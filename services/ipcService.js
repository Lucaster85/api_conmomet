/**
 * IPC del INDEC para sugerir el porcentaje de un ajuste de precio (PLAN_ARCA.md etapa 10, FLOWS.md §73).
 *
 * Fuente: API de series de tiempo de datos.gob.ar (sin API key), serie "IPC Nacional, nivel general, base diciembre 2016". El INDEC publica el índice
 * con ~1 mes de demora: el último mes disponible es siempre algo anterior al actual. Base URL por variable de entorno, para poder mockear en tests.
 *
 * La variación entre dos meses es el cociente de sus índices (no la suma de las variaciones mensuales): `índice(hasta) / índice(desde) - 1`. Hay que
 * decidir qué mes es la base: en un ajuste "desde el mes de la oferta", la base es ese mes y el ajuste va hasta el último mes publicado (o el que se elija).
 *
 * `fetchIpcSeries` nunca tira: ante timeout, status distinto de 200 o payload inesperado devuelve null; el caller muestra "no se pudo consultar, cargalo a mano".
 */
const FETCH_TIMEOUT_MS = 8000;
const IPC_API_URL = process.env.IPC_API_URL || "https://apis.datos.gob.ar/series/api/series/";
const IPC_SERIES_ID = process.env.IPC_SERIES_ID || "148.3_INIVELNAL_DICI_M_26";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const isMonth = (value) => typeof value === "string" && MONTH_RE.test(value);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Convierte las filas de la API (`[["2026-10-01", 12785.93], ...]`) en `{ "2026-10": 12785.93 }`. Ignora filas inválidas. */
function parseSeries(payload) {
  const rows = payload && Array.isArray(payload.data) ? payload.data : null;
  if (!rows) return null;
  const series = {};
  for (const row of rows) {
    if (!Array.isArray(row) || typeof row[0] !== "string") continue;
    const value = Number(row[1]);
    if (!Number.isFinite(value) || value <= 0) continue;
    series[row[0].slice(0, 7)] = value;
  }
  return Object.keys(series).length > 0 ? series : null;
}

/**
 * Variación del IPC entre dos meses (YYYY-MM) a partir de la serie. `from` es la base (su índice es el 100% del cálculo) y tiene que ser anterior a `to`.
 * @returns {{ from, to, from_index, to_index, percent } | { error: string }}
 */
function ipcVariation(series, from, to) {
  if (!isMonth(from) || !isMonth(to)) return { error: "Indicá los meses como AAAA-MM." };
  if (from >= to) return { error: "El mes base tiene que ser anterior al mes hasta el que se ajusta." };
  const fromIndex = series[from];
  const toIndex = series[to];
  const last = Object.keys(series).sort().pop();
  if (fromIndex === undefined) return { error: `El INDEC no tiene publicado el IPC de ${from}.` };
  if (toIndex === undefined) return { error: `El INDEC todavía no publicó el IPC de ${to} (el último disponible es ${last}).` };
  return { from, to, from_index: fromIndex, to_index: toIndex, percent: round2((toIndex / fromIndex - 1) * 100) };
}

/** Serie de IPC entre dos meses (inclusive), o null si no se pudo consultar. */
async function fetchIpcSeries(from, to) {
  try {
    const url = `${IPC_API_URL}?ids=${encodeURIComponent(IPC_SERIES_ID)}&format=json&collapse=month&start_date=${from}&end_date=${to}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) return null;
    return parseSeries(await response.json());
  } catch {
    return null;
  }
}

/** Último mes publicado (para sugerir el "hasta"). null si no se pudo consultar. */
async function fetchLatestIpcMonth() {
  try {
    const url = `${IPC_API_URL}?ids=${encodeURIComponent(IPC_SERIES_ID)}&format=json&limit=1&sort=desc`;
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) return null;
    const series = parseSeries(await response.json());
    return series ? Object.keys(series).sort().pop() : null;
  } catch {
    return null;
  }
}

module.exports = { parseSeries, ipcVariation, fetchIpcSeries, fetchLatestIpcMonth, isMonth };
