// Punto de entrada de la integración con ARCA. Las pantallas y controllers usan esto, no los módulos de abajo.
const db = require("../../models");
const { CBTE_TIPO, CBTE_TIPO_LABELS } = require("./codes");
const { getArcaConfig, describeCertificate } = require("./credentials");
const { getAuth } = require("./wsaa");
const wsfe = require("./wsfe");
const wsfecred = require("./wsfecred");
const { ArcaError } = require("./errors");
const { normalizeCuit } = require("../../helpers/cuit");
const { todayInArgentina } = require("../../helpers/argentinaDate");

/**
 * Estado de la integración sin llamar a ARCA (no hace red): ambiente, CUIT emisor, certificado y si coincide con el
 * CUIT de "Datos de mi empresa". Es lo que muestra la pantalla al abrirse.
 */
async function getStatus() {
  const config = getArcaConfig();
  const profile = await db.CompanyProfile.findByPk(1);
  const profileCuit = profile ? normalizeCuit(profile.cuit) : null;
  const cuitMatches = config.cuit && profileCuit ? config.cuit === profileCuit : null;

  return {
    enabled: config.enabled,
    env: config.env,
    cuit: config.cuit,
    config_error: config.error,
    certificate: config.enabled ? describeCertificate() : null,
    // En homologación es esperable que no coincida (se prueba con el CUIT personal): solo se avisa. En producción
    // la emisión se bloquea (etapa 2).
    cuit_matches_profile: cuitMatches,
    cuit_mismatch_blocks: cuitMatches === false && config.env === "produccion",
  };
}

// Cada paso es independiente: si uno falla, la pantalla muestra los demás.
async function step(fn) {
  try {
    return { ok: true, ...(await fn()) };
  } catch (error) {
    return { ok: false, error: error instanceof ArcaError ? error.message : "Error inesperado al consultar ARCA." };
  }
}

/**
 * "Probar conexión": FEDummy, login (WSAA), puntos de venta, último autorizado y cotización del dólar.
 * Tira ArcaError si la integración está apagada o mal configurada; los fallos de red o de ARCA salen dentro de cada paso.
 */
async function testConnection() {
  const status = await getStatus();
  if (!status.enabled) {
    throw new ArcaError(status.config_error ? "config" : "disabled", status.config_error || "La integración con ARCA está apagada (ARCA_ENV sin definir).");
  }

  const result = { ...status };

  result.dummy = await step(async () => ({ servers: await wsfe.dummy() }));

  result.login = await step(async () => {
    const auth = await getAuth();
    return { expires_at: auth.expiresAt.toISOString(), source: auth.source };
  });

  // Seguimiento de FCE (wsfecred): servicio aparte con su propio ticket y su propia autorización en ARCA; si falla, el mensaje dice qué autorizar. No depende del resto.
  // No usa `dummy` (ARCA lo niega con Acceso Denegado): hace login y una consulta acotada.
  result.fce_tracking = await step(async () => wsfecred.checkAccess(todayInArgentina()));

  // Sin login no tiene sentido seguir: el resto necesita el ticket.
  if (!result.login.ok) return result;

  result.points_of_sale = await step(async () => ({ items: await wsfe.getPointsOfSale() }));

  const localPoints = await db.CompanyPointOfSale.findAll({ where: { type: "web_service", is_active: true }, order: [["number", "ASC"]] });
  const lastAuthorized = [];
  for (const pos of localPoints) {
    for (const cbteTipo of [CBTE_TIPO.FACTURA_A, CBTE_TIPO.FCE_A_FACTURA]) {
      const row = await step(async () => ({ number: await wsfe.getLastAuthorized(pos.number, cbteTipo) }));
      lastAuthorized.push({ pos_number: pos.number, cbte_tipo: cbteTipo, label: CBTE_TIPO_LABELS[cbteTipo], ...row });
    }
  }
  result.last_authorized = { ok: lastAuthorized.every((r) => r.ok), items: lastAuthorized };

  result.usd_rate = await step(async () => wsfe.getExchangeRate("DOL"));

  return result;
}

/**
 * "Validar con ARCA": compara los puntos de venta de tipo web service cargados en la app con los que lista ARCA.
 * En homologación no hay puntos dados de alta: solo avisa y no bloquea.
 */
async function validatePointsOfSale() {
  const status = await getStatus();
  if (!status.enabled) {
    throw new ArcaError(status.config_error ? "config" : "disabled", status.config_error || "La integración con ARCA está apagada (ARCA_ENV sin definir).");
  }

  const arcaPoints = await wsfe.getPointsOfSale();
  const byNumber = new Map(arcaPoints.map((p) => [p.number, p]));
  const localPoints = await db.CompanyPointOfSale.findAll({ where: { type: "web_service" }, order: [["number", "ASC"]] });

  const results = localPoints.map((pos) => {
    const arca = byNumber.get(pos.number);
    let state = "ok";
    if (!arca) state = "not_found";
    else if (arca.blocked || arca.deactivated_at) state = "blocked";
    return { id: pos.id, number: pos.number, state, emission_type: arca ? arca.emission_type : null };
  });

  const enforced = status.env === "produccion";
  return {
    env: status.env,
    // En producción un punto que ARCA no lista no se puede usar para emitir; en homologación es lo esperable.
    enforced,
    has_problems: results.some((r) => r.state !== "ok"),
    results,
    arca_points: arcaPoints,
  };
}

module.exports = { getStatus, testConnection, validatePointsOfSale, getAuth, wsfe, wsfecred, ArcaError };
