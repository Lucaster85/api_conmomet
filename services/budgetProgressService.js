// Avance real de obra (PLAN_ARCA.md etapa 9, §3.4; FLOWS.md §72). Medición PARALELA a la de horas: no la modifica, se muestra al lado y alimenta el
// aviso "Facturado > avance real".
//
// El avance es ACUMULADO (%). El avance vigente de un presupuesto es la última medición (por fecha y, a igual fecha, la última cargada) que CUENTA:
// las cargadas a mano y los certificados APROBADOS. Un certificado presentado todavía no cuenta (el cliente no lo aprobó) y uno rechazado nunca.
const COUNTED_SOURCES = ["manual"];

/** ¿La medición cuenta como avance real? Manual, o certificado aprobado. */
const isCounted = (entry) => COUNTED_SOURCES.includes(entry.source) || entry.status === "approved";

const num = (v) => (v === null || v === undefined ? null : Number(v));
const byDateThenId = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id);

/** Avance vigente: la última medición que cuenta, o null si no hay. */
function currentProgress(entries) {
  const counted = (entries || []).filter(isCounted).sort(byDateThenId);
  if (counted.length === 0) return null;
  const last = counted[counted.length - 1];
  return { entry_id: last.id, percent: num(last.percent), date: last.date, source: last.source, certificate_number: last.certificate_number || null };
}

/**
 * El avance es acumulado: no puede ser menor al de una medición anterior que cuente, ni mayor al de una posterior. Devuelve el mensaje de error o null.
 * @param {Array} others las demás mediciones del presupuesto (sin la que se está guardando)
 */
function monotonicError(others, { date, percent }) {
  for (const other of others.filter(isCounted)) {
    const otherPercent = num(other.percent);
    if (other.date < date && otherPercent > percent) {
      return `El avance es acumulado: el del ${other.date.split("-").reverse().join("/")} ya es ${otherPercent}%, no puede ser menor.`;
    }
    if (other.date > date && otherPercent < percent) {
      return `El avance es acumulado: el del ${other.date.split("-").reverse().join("/")} es ${otherPercent}%, no puede ser mayor que uno anterior.`;
    }
  }
  return null;
}

function serializeEntry(entry) {
  const data = typeof entry.toJSON === "function" ? entry.toJSON() : entry;
  return { ...data, percent: num(data.percent), counts: isCounted(data) };
}

module.exports = { currentProgress, monotonicError, isCounted, serializeEntry };
