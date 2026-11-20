// Estado de un seguro de caución según su vencimiento (PLAN_ARCA.md §3.5, FLOWS.md §69). Puro: recibe "hoy" (la fecha de Argentina), así se testea sin reloj.
//
// - released: la póliza se devolvió (`released_at`): no avisa más.
// - no_expiration: no tiene vencimiento (Bunge las pide sin fecha): nunca avisa.
// - expired: ya venció.
// - expiring_soon: vence dentro de `notify_days_before` días (o hoy).
// - active: vigente, todavía lejos del vencimiento.

// Días entre dos fechas YYYY-MM-DD (b - a), sin depender de la zona horaria.
function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

function suretyBondStatus(bond, today) {
  if (bond.released_at) return "released";
  if (!bond.expiration_date) return "no_expiration";
  if (bond.expiration_date < today) return "expired";
  return daysBetween(today, bond.expiration_date) <= Number(bond.notify_days_before) ? "expiring_soon" : "active";
}

/** Días que faltan para el vencimiento (negativo si ya venció). null sin vencimiento. */
function daysUntilExpiration(bond, today) {
  return bond.expiration_date ? daysBetween(today, bond.expiration_date) : null;
}

module.exports = { suretyBondStatus, daysUntilExpiration, daysBetween };
