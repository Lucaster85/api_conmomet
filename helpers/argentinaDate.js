/**
 * "Hoy" en Argentina como string YYYY-MM-DD (ver FLOWS.md §48, etapa 3).
 *
 * Por qué no `new Date().toISOString().slice(0, 10)`: eso es la fecha en UTC, y Argentina es UTC-3,
 * así que desde las 21 hs da el día SIGUIENTE — una nota que vence hoy figuraría como vencida (y
 * avisaría) tres horas antes de tiempo.
 *
 * Por qué no `CURDATE()` de MySQL: depende de la zona de la sesión de la conexión, que es config de
 * Sequelize y no se ve en el código que lo usa. Fijar la zona acá hace el resultado independiente de
 * la zona del servidor (Railway corre en UTC) y de la de MySQL.
 *
 * Es la misma "fecha de pared" que arma el frontend con la hora local del navegador
 * (conmomet-app/src/utils/quickNotes.ts#todayKey), así que backend y pantalla coinciden en qué día es.
 */
const ARGENTINA_TZ = "America/Argentina/Buenos_Aires";

// 'en-CA' formatea YYYY-MM-DD de fábrica; es el truco estándar para no armar la fecha a mano.
const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: ARGENTINA_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function todayInArgentina(now = new Date()) {
  return formatter.format(now);
}

module.exports = { todayInArgentina, ARGENTINA_TZ };
