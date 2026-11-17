// Emisión de facturas por ARCA: la máquina de estados (PLAN_ARCA.md §8, B6). El ORDEN es lo que evita duplicados y huecos:
//
//  1. draft -> authorizing con un UPDATE condicional (WHERE arca_status = 'draft'): un doble clic o un reintento pierde.
//  2. Se toma el candado de la numeración (fila de ArcaSequences por ambiente, punto de venta y tipo) con FOR UPDATE.
//  3. Se pide FECompUltimoAutorizado, se GUARDA el número reservado en la factura (commit inmediato, fuera de la transacción
//     del candado) y recién después se llama a FECAESolicitar.
//  4. Resultado A: CAE -> authorized. Resultado R o rechazo de negocio: el número no se consumió -> rejected, con el motivo.
//  5. Timeout o caída: queda en `authorizing` CON su número. Nunca se reintenta a ciegas: "Verificar en ARCA" consulta el
//     comprobante (FECompConsultar) y compara total, receptor y fecha. Si existe, se completa; si no, vuelve a borrador.
//
// El candado se mantiene durante la llamada a ARCA (como mucho 30 s): dos emisiones simultáneas del mismo punto de venta y tipo
// se hacen en fila, así nunca reservan el mismo número.
const { Op } = require("sequelize");
const db = require("../../models");
const { getArcaConfig } = require("./credentials");
const wsfe = require("./wsfe");
const fe = require("./feRequest");
const { stripArcaSecrets } = require("./sanitize");
const { ArcaError } = require("./errors");
const { todayInArgentina } = require("../../helpers/argentinaDate");
const { recordAudit } = require("../auditLogService");

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

function requireEnabled() {
  const config = getArcaConfig();
  if (!config.enabled) throw fail(config.error || "La integración con ARCA está apagada en este servidor.", 409);
  return config;
}

async function loadContext(invoiceId) {
  const invoice = await db.Invoice.findByPk(invoiceId, { include: [{ model: db.InvoiceLine, as: "lines" }] });
  if (!invoice || invoice.source !== "arca") throw fail("Factura no encontrada.", 404);
  const [client, pointOfSale, company] = await Promise.all([
    db.Client.findByPk(invoice.client_id),
    invoice.point_of_sale_id ? db.CompanyPointOfSale.findByPk(invoice.point_of_sale_id) : null,
    db.CompanyProfile.findByPk(1),
  ]);
  return { invoice, client, pointOfSale, company };
}

const STATE_MESSAGES = {
  authorizing: "La factura se está emitiendo o quedó sin resolver: usá «Verificar en ARCA».",
  authorized: "La factura ya fue emitida.",
  rejected: "ARCA rechazó la factura. Corregila y volvé a emitir, o descartala.",
  manual: "Esta factura no se emite por ARCA.",
};

// Rechazo DEFINITIVO de ARCA: el comprobante no se procesó (errores en la respuesta, con código). Un fault SOAP o un
// problema de red no cuentan: en esos casos ARCA pudo haberlo autorizado.
const isDefinitiveRejection = (error) => error instanceof ArcaError && error.code === "afip" && error.details && Array.isArray(error.details.codes);

async function authorize(invoice, { parsed, number, company, pointOfSale, client, env, user, via }) {
  const result = {
    resultado: parsed.resultado,
    cae: parsed.cae,
    cae_expiration: parsed.cae_expiration,
    number,
    process_date: parsed.process_date,
    observations: parsed.observations,
    events: parsed.events,
    env,
    via,
  };
  await db.Invoice.update(
    {
      arca_status: "authorized",
      number,
      cae: parsed.cae,
      cae_expiration: parsed.cae_expiration,
      authorized_at: new Date(),
      arca_env: env,
      arca_result: stripArcaSecrets(result),
      issuer_snapshot: fe.buildIssuerSnapshot(company, pointOfSale),
      recipient_snapshot: fe.buildRecipientSnapshot(client, invoice),
    },
    { where: { id: invoice.id } }
  );
  await recordAudit({
    entityType: "Invoice", entityId: invoice.id, action: "update", fieldChanged: "arca_status",
    previousValue: "authorizing", newValue: "authorized", amount: invoice.total_amount,
    context: { env, cbte_tipo: invoice.cbte_tipo, pos_number: invoice.pos_number, number, cae: parsed.cae, via },
    userId: user && user.id,
  });
}

async function markRejected(invoice, { reason, env, user, codes }) {
  await db.Invoice.update(
    {
      arca_status: "rejected",
      number: null,
      arca_result: stripArcaSecrets({ resultado: "R", reason, codes: codes || [], env }),
    },
    { where: { id: invoice.id } }
  );
  await recordAudit({
    entityType: "Invoice", entityId: invoice.id, action: "update", fieldChanged: "arca_status",
    previousValue: "authorizing", newValue: "rejected", amount: invoice.total_amount,
    context: { env, reason }, userId: user && user.id,
  });
}

const revertToDraft = (invoiceId) =>
  db.Invoice.update({ arca_status: "draft", number: null, arca_env: null }, { where: { id: invoiceId, arca_status: "authorizing" } });

/**
 * Emite un borrador en ARCA. Devuelve la factura autorizada o tira un error con `status` y mensaje legible.
 */
async function emitInvoice(invoiceId, user) {
  const config = requireEnabled();
  const { invoice, client, pointOfSale, company } = await loadContext(invoiceId);
  if (invoice.status === "cancelled") throw fail("La factura está anulada.", 409);
  if (invoice.arca_status !== "draft") throw fail(STATE_MESSAGES[invoice.arca_status] || "La factura no se puede emitir.", 409);

  const problems = fe.validateEmission({
    invoice: invoice.toJSON(), client, pointOfSale, company, config, today: todayInArgentina(),
  });
  if (problems.length) throw Object.assign(fail(problems.join(" · "), 400), { problems });

  // La fila-candado tiene que existir antes de poder bloquearla. Se crea FUERA de la transacción del candado: si dos emisiones
  // simultáneas la crean por primera vez, una choca con el índice único y se ignora (ya existe, que es lo que se quería).
  const scope = { env: config.env, pos_number: pointOfSale.number, cbte_tipo: Number(invoice.cbte_tipo) };
  await db.ArcaSequence.findOrCreate({ where: scope, defaults: scope }).catch((error) => {
    if (error.name !== "SequelizeUniqueConstraintError") throw error;
  });

  // Paso 1 (B6): el UPDATE condicional es el que frena el doble clic.
  const [claimed] = await db.Invoice.update(
    { arca_status: "authorizing", arca_env: config.env },
    { where: { id: invoice.id, arca_status: "draft", source: "arca" } }
  );
  if (!claimed) throw fail("Esta factura ya se está emitiendo o dejó de ser un borrador.", 409);

  const transaction = await db.sequelize.transaction();
  let called = false;
  try {
    // Paso 2: candado de la numeración.
    await db.ArcaSequence.findOne({ where: scope, lock: transaction.LOCK.UPDATE, transaction });

    // Una emisión anterior sin resolver en el mismo punto de venta y tipo frena a las siguientes: su número puede estar
    // consumido o no en ARCA, y hasta saberlo no se puede numerar la que sigue. "Sin resolver" = `authorizing` CON número
    // reservado: una que solo está esperando el candado (ya reclamada, todavía sin número) no cuenta. Quien tiene el candado
    // está emitiendo; cuando lo suelta, la factura queda autorizada, rechazada o sin resolver.
    const stuck = await db.Invoice.findOne({
      where: {
        arca_status: "authorizing", arca_env: config.env, pos_number: scope.pos_number, cbte_tipo: scope.cbte_tipo,
        number: { [Op.ne]: null }, id: { [Op.ne]: invoice.id },
      },
      transaction,
    });
    if (stuck) {
      throw fail(
        `Hay una factura sin resolver en este punto de venta (${fe.voucherLabel(stuck.cbte_tipo, stuck.pos_number, stuck.number || 0)}). Verificala en ARCA antes de emitir otra.`,
        409
      );
    }

    // Paso 3: número a reservar. La fecha no puede ser anterior a la del último comprobante del mismo punto de venta y tipo.
    const last = await wsfe.getLastAuthorized(scope.pos_number, scope.cbte_tipo);
    if (last > 0) {
      const lastVoucher = await wsfe.getVoucher(scope.cbte_tipo, scope.pos_number, last);
      const lastDate = lastVoucher && fe.fromArcaDate(lastVoucher.CbteFch);
      if (lastDate && invoice.issue_date < lastDate) {
        throw fail(`La fecha de emisión no puede ser anterior a la del último comprobante de este punto de venta (${lastDate}).`, 400);
      }
    }
    const number = last + 1;
    // Se guarda y se confirma ANTES de llamar a ARCA: si el proceso se cae a mitad de camino, el número reservado queda anotado.
    await db.Invoice.update({ number }, { where: { id: invoice.id } });

    const request = fe.buildCaeRequest({ invoice: invoice.toJSON(), number, pointOfSale });
    called = true;

    let response;
    try {
      response = await wsfe.requestCae(request);
    } catch (error) {
      if (isDefinitiveRejection(error)) {
        await markRejected(invoice, { reason: error.message, env: config.env, user, codes: error.details.codes });
        throw fail(error.message, 422);
      }
      // Ambiguo: la factura queda `authorizing` con su número reservado.
      throw fail(
        "No se pudo confirmar la emisión con ARCA (sin respuesta). La factura quedó «autorizando»: usá «Verificar en ARCA» para saber si se emitió. No la vuelvas a emitir.",
        502
      );
    }

    const parsed = fe.parseCaeResponse(response);
    if (!parsed.approved) {
      const reason = `ARCA rechazó la factura: ${fe.describeRejection(parsed)}`;
      await markRejected(invoice, { reason, env: config.env, user, codes: parsed.observations.map((o) => o.code) });
      throw fail(reason, 422);
    }

    await authorize(invoice, { parsed, number, company, pointOfSale, client, env: config.env, user, via: "emit" });
  } catch (error) {
    // Falló antes de hablar con ARCA: no hay nada que resolver, vuelve a borrador y libera el número.
    if (!called) await revertToDraft(invoice.id);
    await transaction.rollback().catch(() => {});
    throw error;
  }
  await transaction.commit();
  return db.Invoice.findByPk(invoice.id, { include: [{ model: db.InvoiceLine, as: "lines" }] });
}

/**
 * "Verificar en ARCA": resuelve una factura que quedó `authorizing` consultando el comprobante. Devuelve
 * { outcome: 'authorized' | 'back_to_draft', invoice }.
 */
async function verifyInvoice(invoiceId, user) {
  const config = requireEnabled();
  const { invoice, client, pointOfSale, company } = await loadContext(invoiceId);
  if (invoice.arca_status !== "authorizing") throw fail("Solo se puede verificar una factura que quedó «autorizando».", 409);
  if (invoice.arca_env && invoice.arca_env !== config.env) {
    throw fail(`La factura se emitió en ${invoice.arca_env} y este servidor está en ${config.env}: no se puede verificar desde acá.`, 409);
  }
  if (!invoice.number || !pointOfSale) {
    // Quedó antes de reservar un número: no hay nada en ARCA.
    await revertToDraft(invoice.id);
    return { outcome: "back_to_draft", invoice: await db.Invoice.findByPk(invoice.id, { include: [{ model: db.InvoiceLine, as: "lines" }] }) };
  }

  const voucher = await wsfe.getVoucher(invoice.cbte_tipo, pointOfSale.number, invoice.number);
  if (!voucher) {
    await revertToDraft(invoice.id);
    await recordAudit({
      entityType: "Invoice", entityId: invoice.id, action: "update", fieldChanged: "arca_status",
      previousValue: "authorizing", newValue: "draft", context: { env: config.env, number: invoice.number, reason: "ARCA no tiene el comprobante" },
      userId: user && user.id,
    });
    return { outcome: "back_to_draft", invoice: await db.Invoice.findByPk(invoice.id, { include: [{ model: db.InvoiceLine, as: "lines" }] }) };
  }

  // Existe un comprobante con ese número: hay que confirmar que es ESTA factura (total, receptor y fecha).
  const sameTotal = Math.abs(Number(voucher.ImpTotal) - Number(invoice.total_amount)) < 0.005;
  const sameRecipient = String(voucher.DocNro) === String(invoice.recipient_doc_number);
  const sameDate = fe.fromArcaDate(voucher.CbteFch) === invoice.issue_date;
  if (!sameTotal || !sameRecipient || !sameDate || !voucher.CodAutorizacion) {
    throw fail(
      "En ARCA existe un comprobante con ese número pero sus datos no coinciden con esta factura (total, receptor o fecha). No se completó nada: revisalo en ARCA con un administrador.",
      409
    );
  }

  const parsed = {
    resultado: voucher.Resultado || "A",
    cae: String(voucher.CodAutorizacion).trim(),
    cae_expiration: fe.fromArcaDate(voucher.FchVto),
    process_date: voucher.FchProceso ? String(voucher.FchProceso) : null,
    observations: [],
    events: [],
  };
  await authorize(invoice, { parsed, number: invoice.number, company, pointOfSale, client, env: config.env, user, via: "verify" });
  return { outcome: "authorized", invoice: await db.Invoice.findByPk(invoice.id, { include: [{ model: db.InvoiceLine, as: "lines" }] }) };
}

/** "Descartar": borrador o rechazada (nunca tuvieron CAE). Libera el saldo sin necesitar una nota de crédito (B8). */
async function discardInvoice(invoiceId, user) {
  const { invoice } = await loadContext(invoiceId);
  if (!["draft", "rejected"].includes(invoice.arca_status) || invoice.status === "cancelled") {
    throw fail("Solo se puede descartar un borrador o una factura rechazada por ARCA.", 409);
  }
  const previous = invoice.arca_status;
  await db.Invoice.update(
    { status: "cancelled", cancelled_at: new Date(), cancellation_reason: "Descartada: nunca se emitió en ARCA." },
    { where: { id: invoice.id, arca_status: previous } }
  );
  await recordAudit({
    entityType: "Invoice", entityId: invoice.id, action: "update", fieldChanged: "status",
    previousValue: invoice.status, newValue: "cancelled", amount: invoice.total_amount,
    context: { reason: "Descartada", arca_status: previous }, userId: user && user.id,
  });
  return db.Invoice.findByPk(invoice.id, { include: [{ model: db.InvoiceLine, as: "lines" }] });
}

module.exports = { emitInvoice, verifyInvoice, discardInvoice, isDefinitiveRejection };
