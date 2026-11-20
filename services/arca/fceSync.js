// Sincronización del seguimiento de FCE con ARCA (wsfecred, FLOWS.md §77). Trae el estado de las FCE emitidas por la app, lo guarda tal cual lo da ARCA y deriva
// `fce_acceptance` de ahí (la carga a mano se eliminó: la única fuente es ARCA). Una factura que ARCA no devuelve NO se toca: puede ser demora de ARCA.
const { Op } = require("sequelize");
const db = require("../../models");
const { recordAudit } = require("../auditLogService");
const { todayInArgentina } = require("../../helpers/argentinaDate");
const { getArcaConfig } = require("./credentials");
const { ArcaError } = require("./errors");
const { FCE_TIPOS, CBTE_TIPO, CBTE_TIPO_LABELS } = require("./codes");
const wsfecred = require("./wsfecred");

// Dos clics (o dos usuarios) no sincronizan a la vez: un solo UPDATE condicional gana el turno (mismo truco que claimSyncSlot de expirationNotifier, FLOWS.md §38).
const MIN_INTERVAL_MS = 60 * 1000;

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const keyOf = (cbteTipo, pos, number) => `${Number(cbteTipo)}|${Number(pos)}|${Number(number)}`;
const labelOf = (inv) => `${CBTE_TIPO_LABELS[inv.cbte_tipo] || `Comprobante ${inv.cbte_tipo}`} ${String(inv.pos_number).padStart(4, "0")}-${String(inv.number).padStart(8, "0")}`;
const dateStr = (v) => (v ? (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)) : null);

/**
 * Qué muestra la pantalla de aceptación (`fce_acceptance`: pending / accepted / rejected), derivado de los estados de ARCA. Pura.
 * Aceptada / Informada al ADC / Cancelada totalmente → accepted; Rechazada → rejected; el resto (Pendiente, Recepcionada, Modificable) → pending.
 * Sin ningún estado conocido devuelve null: no hay con qué decidir y no se pisa lo que haya.
 */
function deriveAcceptance(cmpState, accountState) {
  if (!cmpState && !accountState) return null;
  if (cmpState === "Rechazado" || accountState === "Rechazada") return "rejected";
  if (["Aceptado", "InformadaAgDpto"].includes(cmpState) || ["Aceptada", "InformadaAgDpto", "CanceladaTotal"].includes(accountState)) return "accepted";
  return "pending";
}

/** Grupo con el que se filtra y se cuenta en la pestaña FCE. Pura. */
function stateGroup(inv) {
  const { fce_cmp_state: cmp, fce_account_state: account } = inv;
  if (account === "CanceladaTotal") return "cancelled";
  if (account === "InformadaAgDpto" || cmp === "InformadaAgDpto") return "informed";
  if (account === "Rechazada" || cmp === "Rechazado") return "rejected";
  if (account === "Aceptada" || cmp === "Aceptado") return "accepted";
  return "pending";
}

/**
 * Una FCE en estado final no vuelve a cambiar, así que no se vuelve a consultar: cuenta Rechazada, Cancelada totalmente o Informada al ADC, o Aceptada con SCA
 * (con SCA, una vez aceptada no puede cambiar de estado). Una ND/NC es final cuando ARCA ya la aceptó, rechazó o informó.
 * `originalFinal` (solo para notas): si la factura original ya es final, una nota que quedó Recepcionada tampoco va a cambiar. Pura.
 */
function isFinal(inv, { originalFinal = false } = {}) {
  if ((inv.kind || "invoice") !== "invoice") {
    if (["Aceptado", "Rechazado", "InformadaAgDpto"].includes(inv.fce_cmp_state)) return true;
    return inv.fce_cmp_state === "Recepcionado" && originalFinal;
  }
  const account = inv.fce_account_state;
  if (["Rechazada", "CanceladaTotal", "InformadaAgDpto"].includes(account)) return true;
  return account === "Aceptada" && inv.fce_transfer_option === "SCA";
}

/**
 * Turno para sincronizar: true solo si este proceso ganó (nadie sincronizó hace menos de `intervalMs`). Devuelve el valor anterior para poder restaurarlo si falla.
 * Model.update y no sequelize.query: devuelve el conteo de filas sin depender del driver (ver expirationNotifier#claimSyncSlot).
 */
async function claimSlot(intervalMs = MIN_INTERVAL_MS, { readPrevious = true } = {}) {
  // El valor anterior solo hace falta para restaurarlo si falla: el barrido automático no lo restaura y se ahorra la lectura (corre en cada latido de la app).
  const setting = readPrevious ? await db.SystemSetting.findByPk(1, { attributes: ["last_fce_sync_at"] }) : null;
  const previous = setting ? setting.last_fce_sync_at : null;
  const now = new Date();
  const [affected] = await db.SystemSetting.update(
    { last_fce_sync_at: now },
    { where: { id: 1, [Op.or]: [{ last_fce_sync_at: null }, { last_fce_sync_at: { [Op.lt]: new Date(now.getTime() - intervalMs) } }] } }
  );
  return affected === 1 ? { claimed: true, previous, now } : { claimed: false };
}

// Si la sincronización falló no se dejó nada hecho: se devuelve el valor anterior (la pantalla no dice "sincronizado hace 1 minuto" y se puede reintentar).
async function releaseSlot(slot) {
  await db.SystemSetting.update({ last_fce_sync_at: slot.previous }, { where: { id: 1, last_fce_sync_at: slot.now } });
}

function currentEnv() {
  const config = getArcaConfig();
  if (!config.enabled) throw new ArcaError(config.error ? "config" : "disabled", config.error || "La integración con ARCA está apagada (ARCA_ENV sin definir).");
  return config;
}

// FCE de la app en este ambiente (cualquier estado): sirven para emparejar y para saber qué comprobantes de ARCA no están en la app.
const appFceWhere = (env) => ({ source: "arca", arca_status: "authorized", cbte_tipo: { [Op.in]: FCE_TIPOS }, arca_env: env, status: { [Op.ne]: "cancelled" } });

/** Cuáles de las facturas hay que volver a consultar: las que no están en estado final. Las notas dependen de si su original ya es final. */
function pickTargets(invoices) {
  const byId = new Map(invoices.map((inv) => [inv.id, inv]));
  return invoices.filter((inv) => {
    const original = inv.associated_invoice_id ? byId.get(inv.associated_invoice_id) : null;
    return !isFinal(inv, { originalFinal: original ? isFinal(original) : false });
  });
}

/**
 * Aplica lo que dijo ARCA a una factura: actualiza columnas, deriva la aceptación y audita los cambios de estado.
 * @returns {Promise<{ changes: object[] }>}
 */
async function applyToInvoice(inv, cmp, cta, user) {
  const isNote = (inv.kind || "invoice") !== "invoice";
  const now = new Date();
  const values = {
    fce_cmp_state: cmp.cmp_state || inv.fce_cmp_state,
    fce_account_code: cmp.account_code !== null ? cmp.account_code : inv.fce_account_code,
    fce_acceptance_type: cmp.acceptance_type,
    fce_available_at: cmp.available_at,
    fce_acceptance_due: cmp.acceptance_due,
    fce_rejection_reasons: cmp.rejection_reasons && cmp.rejection_reasons.length > 0 ? cmp.rejection_reasons : null,
    fce_arca_snapshot: cmp.snapshot,
    fce_synced_at: now,
  };
  if (cta && !isNote) {
    values.fce_account_state = cta.account_state || inv.fce_account_state;
    values.fce_balance = cta.balance;
    values.fce_accepted_balance = cta.accepted_balance;
  }
  // La opción de transferencia vigente es la de ARCA (se puede haber cambiado después de emitir).
  const arcaTransfer = (cta && cta.transfer_option) || cmp.transfer_option;
  if (arcaTransfer && arcaTransfer !== inv.fce_transfer_option) values.fce_transfer_option = arcaTransfer;

  if (!isNote) {
    const acceptance = deriveAcceptance(values.fce_cmp_state, values.fce_account_state !== undefined ? values.fce_account_state : inv.fce_account_state);
    if (acceptance) {
      values.fce_acceptance = acceptance;
      // Fecha de la aceptación o del rechazo: la de ARCA; nunca se inventa una. Si ARCA no la trae y el estado no cambió, se conserva la que había.
      values.fce_acceptance_at = acceptance === "pending" ? null : cmp.accepted_at || (inv.fce_acceptance === acceptance ? inv.fce_acceptance_at : null);
    }
  }

  const changes = [];
  const track = (field, from, to) => {
    if ((from || null) !== (to || null)) changes.push({ invoice_id: inv.id, label: labelOf(inv), field, from: from || null, to: to || null });
  };
  track("fce_cmp_state", inv.fce_cmp_state, values.fce_cmp_state);
  if (!isNote) track("fce_account_state", inv.fce_account_state, values.fce_account_state !== undefined ? values.fce_account_state : inv.fce_account_state);
  track("fce_transfer_option", inv.fce_transfer_option, values.fce_transfer_option !== undefined ? values.fce_transfer_option : inv.fce_transfer_option);

  await inv.update(values);
  for (const change of changes) {
    await recordAudit({
      entityType: "Invoice", entityId: inv.id, action: "update", fieldChanged: change.field, previousValue: change.from, newValue: change.to,
      amount: inv.total_amount, userId: user ? user.id : null, notes: "Sincronización con ARCA (wsfecred)",
    });
  }
  return { changes };
}

/**
 * Núcleo común: consulta a ARCA con el rango dado, empareja y actualiza. `knownKeys` (solo en syncAll) son todas las FCE de la app: lo que ARCA devuelve fuera de eso se
 * lista aparte (D8) sin importarse.
 */
async function run({ targets, fecha, comprobantesFilter = {}, knownKeys = null, user }) {
  const comprobantes = await wsfecred.consultarComprobantes({ fecha, ...comprobantesFilter });
  const accounts = await wsfecred.consultarCtasCtes({ fecha });

  const cmpByKey = new Map(comprobantes.items.map((c) => [keyOf(c.cbte_tipo, c.pos_number, c.number), c]));
  const accountByCode = new Map(accounts.items.filter((a) => a.account_code !== null).map((a) => [a.account_code, a]));
  const accountByKey = new Map(accounts.items.map((a) => [keyOf(a.cbte_tipo, a.pos_number, a.number), a]));

  const result = { checked: targets.length, updated: 0, changes: [], not_found_in_arca: [], only_in_arca: [], truncated: comprobantes.truncated || accounts.truncated };
  const matched = new Set();

  for (const inv of targets) {
    const key = keyOf(inv.cbte_tipo, inv.pos_number, inv.number);
    const cmp = cmpByKey.get(key);
    if (!cmp) {
      result.not_found_in_arca.push({ invoice_id: inv.id, label: labelOf(inv) });
      continue;
    }
    matched.add(key);
    const cta = (cmp.account_code !== null && accountByCode.get(cmp.account_code)) || accountByKey.get(key) || null;
    const { changes } = await applyToInvoice(inv, cmp, cta, user);
    if (changes.length > 0) result.updated += 1;
    result.changes.push(...changes);
  }

  if (knownKeys) {
    for (const cmp of comprobantes.items) {
      const key = keyOf(cmp.cbte_tipo, cmp.pos_number, cmp.number);
      if (knownKeys.has(key)) continue;
      result.only_in_arca.push({ cbte_tipo: cmp.cbte_tipo, label: `${CBTE_TIPO_LABELS[cmp.cbte_tipo] || `Comprobante ${cmp.cbte_tipo}`} ${String(cmp.pos_number).padStart(4, "0")}-${String(cmp.number).padStart(8, "0")}`, recipient_cuit: cmp.recipient_cuit, state: cmp.cmp_state });
    }
  }
  return result;
}

/**
 * Sincroniza todas las FCE de la app que todavía pueden cambiar. `user` es quien sincronizó (null si fue el barrido automático).
 * @param {{ intervalMs?: number, restoreOnFailure?: boolean, silentWhenBusy?: boolean }} [options] `silentWhenBusy`: si no gana el turno devuelve null en vez de tirar 409 (barrido automático).
 * @throws {Error} status 409 si ya hay otra sincronización en curso
 */
async function syncAll(user, { intervalMs = MIN_INTERVAL_MS, restoreOnFailure = true, silentWhenBusy = false } = {}) {
  const config = currentEnv();
  const slot = await claimSlot(intervalMs, { readPrevious: restoreOnFailure });
  if (!slot.claimed) {
    if (silentWhenBusy) return null;
    throw fail("Ya hay una sincronización en curso o se hizo hace instantes. Esperá un minuto y probá de nuevo.", 409);
  }
  try {
    const invoices = await db.Invoice.findAll({ where: appFceWhere(config.env) });
    const targets = pickTargets(invoices);
    if (targets.length === 0) return { checked: 0, updated: 0, changes: [], not_found_in_arca: [], only_in_arca: [], truncated: false };

    const oldest = targets.map((inv) => dateStr(inv.issue_date)).sort()[0];
    const knownKeys = new Set(invoices.map((inv) => keyOf(inv.cbte_tipo, inv.pos_number, inv.number)));
    return await run({ targets, fecha: { tipo: "Emision", desde: oldest, hasta: todayInArgentina() }, knownKeys, user });
  } catch (error) {
    if (restoreOnFailure) await releaseSlot(slot);
    throw error;
  }
}

/**
 * Sincroniza una sola factura (y, si es la original, sus notas de crédito y de débito). No toma el turno general: es una consulta acotada.
 * @throws {Error} 404 / 409 si la factura no es una FCE emitida por la app
 */
async function syncOne(invoiceId, user) {
  const config = currentEnv();
  const invoice = await db.Invoice.findByPk(invoiceId);
  if (!invoice) throw fail("Factura no encontrada.", 404);
  if (invoice.source !== "arca" || invoice.arca_status !== "authorized" || !FCE_TIPOS.includes(Number(invoice.cbte_tipo)) || invoice.status === "cancelled" || invoice.arca_env !== config.env) {
    throw fail("Solo se pueden sincronizar Facturas de Crédito Electrónica emitidas por ARCA en este ambiente.", 409);
  }

  const notes = (invoice.kind || "invoice") === "invoice"
    ? await db.Invoice.findAll({ where: { ...appFceWhere(config.env), associated_invoice_id: invoice.id } })
    : [];
  const targets = [invoice, ...notes];
  const fecha = { tipo: "Emision", desde: dateStr(invoice.issue_date), hasta: todayInArgentina() };
  // Con la cuenta corriente conocida se piden solo sus comprobantes (la factura y sus notas); si no, por tipo y rango de fechas.
  const comprobantesFilter = invoice.fce_account_code ? { codCtaCte: Number(invoice.fce_account_code) } : {};
  return run({ targets, fecha, comprobantesFilter, user });
}

/** Historial de estados que tiene ARCA de una FCE (D4: se pide en el momento, no se guarda). Cada parte es independiente: si una falla, la otra se muestra. */
async function history(invoiceId) {
  const config = currentEnv();
  const invoice = await db.Invoice.findByPk(invoiceId);
  if (!invoice) throw fail("Factura no encontrada.", 404);
  if (invoice.source !== "arca" || invoice.arca_status !== "authorized" || !FCE_TIPOS.includes(Number(invoice.cbte_tipo))) {
    throw fail("Solo las Facturas de Crédito Electrónica emitidas por ARCA tienen historial de estados.", 409);
  }
  const part = async (fn) => {
    try {
      return { ok: true, items: await fn() };
    } catch (error) {
      return { ok: false, items: [], error: error instanceof ArcaError ? error.message : "Error inesperado al consultar ARCA." };
    }
  };
  const comprobante = await part(() => wsfecred.consultarHistorialEstadosComprobante({ cuitEmisor: config.cuit, cbteTipo: invoice.cbte_tipo, posNumber: invoice.pos_number, number: invoice.number }));
  const hasAccount = Number(invoice.cbte_tipo) === CBTE_TIPO.FCE_A_FACTURA && invoice.fce_account_code;
  const account = hasAccount ? await part(() => wsfecred.consultarHistorialEstadosCtaCte(Number(invoice.fce_account_code))) : null;
  return { comprobante, cuenta_corriente: account };
}

module.exports = { syncAll, syncOne, history, deriveAcceptance, stateGroup, isFinal, pickTargets, claimSlot, releaseSlot, MIN_INTERVAL_MS };
