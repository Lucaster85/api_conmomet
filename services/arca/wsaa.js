// WSAA: login de ARCA. Se firma un ticket (TRA) en CMS con el certificado y devuelve token + sign, válidos 12 h.
// WSAA rechaza un login nuevo si ya hay un ticket vigente para ese certificado y servicio, y Railway reinicia los
// contenedores: por eso el ticket se guarda cifrado en `arca_tokens` (S1) por (env, cuit, service), y el login se
// serializa con un bloqueo sobre esa fila (B7).
const db = require("../../models");
const { ENVS, SERVICE_WSFE } = require("./codes");
const { getArcaConfig, loadCredentials } = require("./credentials");
const { getSoapClient, toArcaError } = require("./soapClient");
const { soapRequestOptions } = require("./http");
const { encryptSecret } = require("./tokenCrypto");
const { buildLoginTicketRequest, signLoginTicket, parseLoginResponse, readCachedTicket } = require("./ticket");
const { ArcaError } = require("./errors");

async function requestLogin(env, service, creds) {
  const tra = buildLoginTicketRequest(service);
  const cms = signLoginTicket(tra, creds.cert, creds.privateKey);
  const urls = ENVS[env];
  const client = await getSoapClient(urls.wsaaWsdl, urls.wsaaEndpoint);
  try {
    const [result] = await client.loginCmsAsync({ in0: cms }, soapRequestOptions());
    const xml = typeof result.loginCmsReturn === "string" ? result.loginCmsReturn : "";
    return parseLoginResponse(xml);
  } catch (error) {
    if (error instanceof ArcaError) throw error;
    const text = String((error && error.root && error.root.Envelope && error.root.Envelope.Body && error.root.Envelope.Body.Fault && error.root.Envelope.Body.Fault.faultstring) || "");
    if (/ya posee un TA v[aá]lido|alreadyAuthenticated/i.test(text) || /alreadyAuthenticated/i.test(String(error && error.message))) {
      throw new ArcaError(
        "wsaa_already_authenticated",
        "ARCA ya tiene un ticket de acceso vigente para este certificado, emitido desde otro servidor o equipo que usa el mismo certificado. " +
          "Esperá a que venza (hasta 12 horas) o usá un certificado distinto por ambiente."
      );
    }
    throw toArcaError(error, "No se pudo iniciar sesión en ARCA (WSAA)");
  }
}

const inflight = new Map();

/**
 * Credenciales vigentes para llamar a un servicio de ARCA: { token, sign, cuit, env, expiresAt, source }.
 * `source` es "cache" (salió de la base) o "login" (se pidió un ticket nuevo). Nunca se loguea ni se devuelve por la API.
 */
function getAuth(service = SERVICE_WSFE) {
  const config = getArcaConfig();
  if (config.error) return Promise.reject(new ArcaError("config", config.error));
  if (!config.enabled) return Promise.reject(new ArcaError("disabled", "La integración con ARCA está apagada (ARCA_ENV sin definir)."));

  const key = `${config.env}:${config.cuit}:${service}`;
  if (!inflight.has(key)) {
    const promise = loadAuth(config, service).finally(() => inflight.delete(key));
    inflight.set(key, promise);
  }
  return inflight.get(key);
}

async function loadAuth(config, service) {
  const creds = loadCredentials();
  const where = { env: config.env, cuit: config.cuit, service };
  // La fila tiene que existir para poder bloquearla: findOrCreate la deja como marcador la primera vez.
  await db.ArcaToken.findOrCreate({ where, defaults: where });

  return db.sequelize.transaction(async (transaction) => {
    const row = await db.ArcaToken.findOne({ where, lock: transaction.LOCK.UPDATE, transaction });
    const cached = readCachedTicket(row, creds.keyPem);
    if (cached) return { ...cached, cuit: config.cuit, env: config.env, source: "cache" };

    // El login corre con la fila bloqueada: un segundo pedido simultáneo espera acá y después lee el ticket recién
    // guardado, en vez de pedir otro login que WSAA rechazaría.
    const fresh = await requestLogin(config.env, service, creds);
    await row.update(
      {
        token_encrypted: encryptSecret(fresh.token, creds.keyPem),
        sign_encrypted: encryptSecret(fresh.sign, creds.keyPem),
        generated_at: new Date(),
        expires_at: fresh.expiresAt,
      },
      { transaction }
    );
    return { ...fresh, cuit: config.cuit, env: config.env, source: "login" };
  });
}

module.exports = { getAuth };
