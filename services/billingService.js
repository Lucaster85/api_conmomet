const { Op } = require("sequelize");
const db = require("../models");
const { computeConceptTotals } = require("../helpers/budgetTotals");
const { buildHourBuckets } = require("./projectHoursService");
const { currentProgress } = require("./budgetProgressService");

/**
 * Cálculos de Facturación (ver FLOWS.md, sección Facturación).
 *
 * Qué se factura es el PRESUPUESTO APROBADO, no el proyecto. Por cada presupuesto, moneda y
 * concepto (materiales / mano de obra):
 *   base (neto con bonificación)  -  lo ya facturado (líneas de facturas NO anuladas)  =  saldo
 * El saldo SIEMPRE descuenta los cobros "sin factura": si no, administración podría facturar dos
 * veces lo mismo. Quien no tiene invoices_unofficial no ve esos registros, pero sí que el
 * concepto está cubierto.
 *
 * Los DECIMAL de Sequelize llegan como string — todo pasa por Number() antes de sumar.
 */

const { CONCEPTS, CURRENCIES, TOLERANCE, round2, round4, num, sumBilled, scopeInvoices } = require("./billingMath");

/** Bases (bruto, % de bonificación y neto redondeado) por moneda y concepto. */
function computeBudgetBillingBases(budget, laborLines, materialItems) {
  const raw = computeConceptTotals(budget, laborLines, materialItems);
  const bases = {};
  for (const currency of CURRENCIES) {
    bases[currency] = {};
    for (const concept of CONCEPTS) {
      const c = raw[currency][concept];
      bases[currency][concept] = {
        gross: round2(c.gross),
        discount_percent: c.discount_percent,
        net: round2(c.net),
      };
    }
  }
  return bases;
}

function computeBillingStatus({ hasBase, hasBalance, anyBilled, allPaid }) {
  if (!hasBase || !anyBilled) return "unbilled";
  if (hasBalance) return "partial";
  return allPaid ? "billed_and_paid" : "billed";
}

/**
 * Resumen de facturación de UN presupuesto, a partir de datos ya cargados (permite armar el
 * listado en batch, sin N+1).
 *
 * @param {object} budget  presupuesto (plano) con bonificaciones y moneda
 * @param {object} data
 * @param {Array}  data.laborLines    líneas de mano de obra (estimated_total, currency)
 * @param {Array}  data.materialItems líneas de material (total_price, currency)
 * @param {Array}  data.invoices      facturas del presupuesto con `lines`; las anuladas se ignoran
 * @param {object|null} data.hours    { budgeted_hours_total, consumed_hours_total } PROPIOS del
 *                                    proyecto, o null si el presupuesto todavía no tiene proyecto
 * @param {boolean} data.canSeeUnofficial  si puede ver los cobros "sin factura" en el detalle
 * @param {Array}  [data.progressEntries]  mediciones de avance real de obra del presupuesto (etapa 9)
 */
function buildBillingSummary(budget, { laborLines, materialItems, invoices, hours, canSeeUnofficial, progressEntries = [] }) {
  const bases = computeBudgetBillingBases(budget, laborLines, materialItems);
  const live = invoices.filter((inv) => inv.status !== "cancelled");
  const billed = sumBilled(live);
  // Ajustes de precio facturados (etapa 8): van aparte, no descuentan saldo. Una NC emitida sobre el ajuste lo resta (como en `sumBilled`).
  const adjustments = { ARS: 0, USD: 0 };
  for (const inv of live) {
    if (inv.arca_status === "draft" || inv.arca_status === "rejected") continue;
    const sign = inv.kind === "credit_note" ? (inv.arca_status === "authorized" ? -1 : 0) : 1;
    for (const line of inv.lines || []) {
      if (line.concept === "adjustment" && adjustments[inv.currency] !== undefined) adjustments[inv.currency] = round2(adjustments[inv.currency] + sign * num(line.net_amount));
    }
  }

  // Lo que se cobra: facturas y notas de débito YA emitidas (o cargadas a mano). Los borradores y las rechazadas todavía no son un comprobante,
  // y una nota de crédito no se cobra: baja lo que falta cobrar de su factura original.
  const payable = live.filter((inv) => (inv.kind || "invoice") !== "credit_note" && ["manual", "authorized"].includes(inv.arca_status || "manual"));
  const creditedBy = new Map();
  for (const inv of live) {
    if (inv.kind === "credit_note" && inv.arca_status === "authorized") {
      creditedBy.set(inv.associated_invoice_id, round2((creditedBy.get(inv.associated_invoice_id) || 0) + num(inv.total_amount)));
    }
  }

  const balances = {};
  const billedPercent = {};
  const coveredByReserved = {};
  let hasBase = false;
  let hasBalance = false;
  let anyBilled = false;
  let hasMaterialsBalance = false;

  for (const currency of CURRENCIES) {
    balances[currency] = {};
    billedPercent[currency] = {};
    coveredByReserved[currency] = {};
    for (const concept of CONCEPTS) {
      const base = bases[currency][concept].net;
      const done = billed[currency][concept];
      const balance = round2(Math.max(base - done, 0));
      balances[currency][concept] = balance;
      billedPercent[currency][concept] = base > 0 ? round4((done / base) * 100) : 0;
      coveredByReserved[currency][concept] = live.some((inv) =>
        inv.voucher_type === "sin_factura" && inv.currency === currency
        && (inv.lines || []).some((l) => l.concept === concept),
      );
      if (base > TOLERANCE) hasBase = true;
      if (done > 0) anyBilled = true;
      if (balance > TOLERANCE) {
        hasBalance = true;
        if (concept === "materials") hasMaterialsBalance = true;
      }
    }
  }

  // Cobros pendientes: lo que ya se facturó y todavía no se cobró. Los "sin factura" solo cuentan
  // para quien puede verlos — para el resto, el indicador no tiene que delatar que existen.
  const visibleLive = payable.filter((inv) => canSeeUnofficial || inv.voucher_type !== "sin_factura");
  const pending = visibleLive.filter((inv) => inv.status === "pending");
  const pendingAmount = { ARS: 0, USD: 0 };
  for (const inv of pending) {
    pendingAmount[inv.currency] = round2(pendingAmount[inv.currency] + Math.max(num(inv.total_amount) - (creditedBy.get(inv.id) || 0), 0));
  }

  // Avance de horas: el PROPIO del proyecto del presupuesto (no el consolidado con sus
  // adicionales, que ya tienen su propio presupuesto y su propia fila).
  const budgetedHours = hours ? num(hours.budgeted_hours_total) : null;
  const consumedHours = hours ? num(hours.consumed_hours_total) : null;
  const progressPercent = hours && budgetedHours > 0 ? round2((consumedHours / budgetedHours) * 100) : null;

  // Si la mano de obra se factura en las dos monedas, no hay un único % — se toma el más alto, que
  // es el que dispara la alerta "Facturado > avance" (preferimos avisar de más que de menos).
  const laborBilledPercent = Math.max(billedPercent.ARS.labor, billedPercent.USD.labor);
  const laborHoursBilledEquivalent = hours ? round2((budgetedHours * laborBilledPercent) / 100) : null;
  const overbilledLabor = progressPercent !== null && laborBilledPercent > progressPercent + TOLERANCE;

  // Avance real de obra (etapa 9): medición paralela a la de horas, solo informativa. "Facturado > avance real" compara contra el mismo % de mano de obra.
  const realProgress = currentProgress(progressEntries);
  const overbilledVsReal = realProgress !== null && laborBilledPercent > realProgress.percent + TOLERANCE;

  return {
    budget_id: budget.id,
    bases,
    billed,
    adjustments,
    balances,
    billed_percent: billedPercent,
    covered_by_reserved: coveredByReserved,
    has_balance: hasBalance,
    has_materials_balance: hasMaterialsBalance,
    // Estado de facturación: se CALCULA, no se guarda.
    billing_status: computeBillingStatus({
      hasBase,
      hasBalance,
      anyBilled,
      allPaid: payable.length > 0 && payable.every((inv) => inv.status === "paid"),
    }),
    pending_invoices_count: pending.length,
    pending_amount: pendingAmount,
    has_pending_payment: pending.length > 0,
    project_progress: hours
      ? {
          budgeted_hours_own: round2(budgetedHours),
          consumed_hours_own: round2(consumedHours),
          progress_percent: progressPercent,
        }
      : null,
    labor_billed_percent: laborBilledPercent,
    labor_hours_billed_equivalent: laborHoursBilledEquivalent,
    overbilled_labor: overbilledLabor,
    real_progress: realProgress,
    overbilled_vs_real: overbilledVsReal,
  };
}

/**
 * Facturas (planas, con todas sus líneas) que tienen al menos una línea que cumple `lineWhere`. La relación factura <-> presupuesto / OC está en las
 * líneas (una factura puede cobrar varios presupuestos, FLOWS.md §70), no en la cabecera.
 */
async function invoicesTouching(lineWhere, { transaction, excludeInvoiceId = null } = {}) {
  const rows = await db.InvoiceLine.findAll({ where: lineWhere, attributes: ["invoice_id"], raw: true, transaction });
  let ids = [...new Set(rows.map((r) => r.invoice_id))];
  if (excludeInvoiceId) ids = ids.filter((id) => id !== excludeInvoiceId);
  if (ids.length === 0) return [];
  const invoices = await db.Invoice.findAll({ where: { id: { [Op.in]: ids } }, include: [{ model: db.InvoiceLine, as: "lines" }], transaction });
  return invoices.map((inv) => inv.toJSON());
}

/**
 * Datos necesarios para armar los resúmenes de varios presupuestos con UNA query por tabla:
 * líneas, facturas y horas (buildHourBuckets sobre todos los proyectos a la vez).
 *
 * `invoices` de cada presupuesto son copias recortadas a SUS líneas (una factura compartida entre presupuestos suma en cada uno solo su parte);
 * `allInvoices` son las facturas completas que lo tocan, para listarlas.
 *
 * @param {Array<object>} budgets presupuestos (modelos o planos) con id, project_id y bonificaciones
 * @returns {Promise<Map<number, object>>} budget_id -> datos para buildBillingSummary
 */
async function loadBillingData(budgets, { transaction } = {}) {
  const budgetIds = budgets.map((b) => b.id);
  const result = new Map(budgetIds.map((id) => [id, { laborLines: [], materialItems: [], invoices: [], allInvoices: [], progressEntries: [], hours: null }]));
  if (budgetIds.length === 0) return result;

  const [laborLines, materialItems, touching, progressRows] = await Promise.all([
    db.BudgetLaborLine.findAll({
      where: { budget_id: { [Op.in]: budgetIds } },
      attributes: ["budget_id", "estimated_total", "currency"],
      raw: true,
      transaction,
    }),
    db.BudgetMaterialItem.findAll({
      where: { budget_id: { [Op.in]: budgetIds } },
      attributes: ["budget_id", "total_price", "currency"],
      raw: true,
      transaction,
    }),
    invoicesTouching({ budget_id: { [Op.in]: budgetIds } }, { transaction }),
    db.BudgetProgressEntry.findAll({ where: { budget_id: { [Op.in]: budgetIds } }, attributes: ["id", "budget_id", "date", "percent", "source", "status", "certificate_number"], raw: true, transaction }),
  ]);

  progressRows.forEach((p) => result.get(p.budget_id).progressEntries.push(p));
  laborLines.forEach((l) => result.get(l.budget_id).laborLines.push(l));
  materialItems.forEach((m) => result.get(m.budget_id).materialItems.push(m));
  for (const id of budgetIds) {
    const entry = result.get(id);
    entry.allInvoices = touching.filter((inv) => inv.lines.some((l) => l.budget_id === id));
    entry.invoices = scopeInvoices(touching, (l) => l.budget_id === id);
  }

  const projectIds = [...new Set(budgets.map((b) => b.project_id).filter(Boolean))];
  const bucketsByProject = await buildHourBuckets(projectIds);
  for (const budget of budgets) {
    if (budget.project_id && bucketsByProject.has(budget.project_id)) {
      result.get(budget.id).hours = bucketsByProject.get(budget.project_id);
    }
  }
  return result;
}

/**
 * Lo facturado de cada OC (neto, en la moneda de la OC) y su saldo. Una OC sin monto no tiene saldo (`balance` null): es solo de referencia.
 * Las notas de crédito emitidas restan igual que en el saldo del presupuesto (sus líneas heredan la OC de la línea que acreditan).
 * @param {Array<{id:number, currency:string, amount:number|string|null}>} orders
 * @returns {Promise<Map<number, {billed:number, balance:number|null}>>}
 */
async function purchaseOrderBalances(orders, { transaction, excludeInvoiceId = null } = {}) {
  const result = new Map();
  if (orders.length === 0) return result;
  const touching = await invoicesTouching({ purchase_order_id: { [Op.in]: orders.map((o) => o.id) } }, { transaction, excludeInvoiceId });
  for (const order of orders) {
    const billed = sumBilled(scopeInvoices(touching, (l) => l.purchase_order_id === order.id));
    const done = round2((billed[order.currency] ? billed[order.currency].materials + billed[order.currency].labor : 0));
    result.set(order.id, { billed: done, balance: order.amount === null || order.amount === undefined ? null : round2(Math.max(num(order.amount) - done, 0)) });
  }
  return result;
}

/** Resúmenes de facturación de varios presupuestos: Map<budget_id, resumen>. */
async function computeBillingSummaries(budgets, { canSeeUnofficial = false, transaction } = {}) {
  const plain = budgets.map((b) => (typeof b.toJSON === "function" ? b.toJSON() : b));
  const dataById = await loadBillingData(plain, { transaction });
  const summaries = new Map();
  for (const budget of plain) {
    summaries.set(budget.id, buildBillingSummary(budget, { ...dataById.get(budget.id), canSeeUnofficial }));
  }
  return summaries;
}

/**
 * Valida y normaliza las líneas de una factura. NUNCA confía en el porcentaje o el monto que
 * manda el cliente: parte de uno de los dos (el que cargó el usuario) y recalcula el otro contra
 * la base real del presupuesto de cada línea.
 *
 * Con presupuestos (FLOWS.md §70): cada línea es de UN presupuesto (`budget_id`, o `defaultBudgetId` si no lo indica) y descuenta del saldo de su
 * concepto: ese es el límite duro. Si además tiene una OC (`purchase_order_id`), la OC tiene que ser vigente, del mismo presupuesto y moneda, admitir
 * el concepto y, si tiene monto, alcanzar para la línea. A lo sumo una línea por (presupuesto, OC, concepto) y todas en la moneda de la factura.
 * Sin presupuestos (factura libre): solo líneas "other" con descripción y monto.
 *
 * @param {Map<number, object>} budgets presupuestos involucrados (modelos), ya bloqueados por quien llama
 * @returns {Promise<Array>} líneas listas para InvoiceLine.bulkCreate
 * @throws {Error} con `status = 400` y un mensaje legible
 */
async function validateInvoiceLines({ budgets, defaultBudgetId = null, currency, lines, excludeInvoiceId = null, transaction }) {
  const fail = (message) => Object.assign(new Error(message), { status: 400 });

  if (!Array.isArray(lines) || lines.length === 0) throw fail("La factura necesita al menos una línea.");

  // Factura libre
  if (!budgets || budgets.size === 0) {
    return lines.map((line, index) => {
      if (line.concept !== "other") throw fail("Una factura sin presupuesto solo admite líneas de concepto \"Otro\".");
      const description = String(line.description || "").trim();
      if (!description) throw fail(`La línea ${index + 1} necesita una descripción.`);
      const net = round2(line.net_amount);
      if (!(net > 0)) throw fail(`La línea ${index + 1} necesita un monto mayor a cero.`);
      return { concept: "other", description: description.slice(0, 255), percent: null, net_amount: net, budget_id: null, purchase_order_id: null, progress_entry_id: null };
    });
  }

  if (!CURRENCIES.includes(currency)) throw fail("La moneda de la factura no es válida.");

  const budgetIds = [...budgets.keys()];
  const [laborLines, materialItems, touching] = await Promise.all([
    db.BudgetLaborLine.findAll({ where: { budget_id: { [Op.in]: budgetIds } }, attributes: ["budget_id", "estimated_total", "currency"], raw: true, transaction }),
    db.BudgetMaterialItem.findAll({ where: { budget_id: { [Op.in]: budgetIds } }, attributes: ["budget_id", "total_price", "currency"], raw: true, transaction }),
    invoicesTouching({ budget_id: { [Op.in]: budgetIds } }, { transaction, excludeInvoiceId }),
  ]);

  // Bases y saldo por presupuesto (sin contar la propia factura, si se está corrigiendo).
  const context = new Map();
  for (const id of budgetIds) {
    const budget = budgets.get(id);
    const bases = computeBudgetBillingBases(
      budget.toJSON ? budget.toJSON() : budget,
      laborLines.filter((l) => l.budget_id === id),
      materialItems.filter((m) => m.budget_id === id)
    );
    context.set(id, { bases, billed: sumBilled(scopeInvoices(touching, (l) => l.budget_id === id)), budget });
  }

  // OC referenciadas: se cargan una vez, con lo ya facturado contra cada una.
  const orderIds = [...new Set(lines.map((l) => (l.purchase_order_id ? Number(l.purchase_order_id) : null)).filter(Boolean))];
  const orders = new Map();
  if (orderIds.length > 0) {
    const rows = await db.ClientPurchaseOrder.findAll({ where: { id: { [Op.in]: orderIds } }, transaction });
    rows.forEach((o) => orders.set(o.id, o));
    const balances = await purchaseOrderBalances(rows.map((o) => ({ id: o.id, currency: o.currency, amount: o.amount })), { transaction, excludeInvoiceId });
    rows.forEach((o) => { o.billedSoFar = balances.get(o.id).billed; });
  }

  // Avance real que factura cada línea (opcional): tiene que ser del mismo presupuesto y no estar rechazado.
  const progressIds = [...new Set(lines.map((l) => (l.progress_entry_id ? Number(l.progress_entry_id) : null)).filter(Boolean))];
  const progressEntries = new Map();
  if (progressIds.length > 0) {
    const rows = await db.BudgetProgressEntry.findAll({ where: { id: { [Op.in]: progressIds } }, transaction });
    rows.forEach((p) => progressEntries.set(p.id, p));
  }

  const label = { materials: "materiales", labor: "mano de obra" };
  const seen = new Set();
  const consumedBudget = new Map();
  const consumedOrder = new Map();

  return lines.map((line) => {
    const budgetId = Number(line.budget_id || defaultBudgetId);
    const ctx = context.get(budgetId);
    if (!ctx) throw fail("Una de las líneas es de un presupuesto que no es parte de esta factura.");
    const where = budgets.size > 1 ? ` (presupuesto ${ctx.budget.number})` : "";

    if (!CONCEPTS.includes(line.concept)) {
      throw fail("Una factura de un presupuesto solo admite conceptos de materiales o mano de obra.");
    }

    const orderId = line.purchase_order_id ? Number(line.purchase_order_id) : null;
    let order = null;
    if (orderId) {
      order = orders.get(orderId);
      if (!order) throw fail("La OC elegida no existe.");
      if (order.budget_id !== budgetId) throw fail(`La OC ${order.number} no pertenece al presupuesto de la línea${where}.`);
      if (order.status !== "active") throw fail(`La OC ${order.number} no está vigente.`);
      if (order.currency !== currency) throw fail(`La OC ${order.number} es en ${order.currency}: no se puede facturar en ${currency} contra ella.`);
      if (order.concept !== "all" && order.concept !== line.concept) {
        throw fail(`La OC ${order.number} es solo de ${label[order.concept]}: no admite ${label[line.concept]}.`);
      }
    }

    const progressId = line.progress_entry_id ? Number(line.progress_entry_id) : null;
    if (progressId) {
      const entry = progressEntries.get(progressId);
      if (!entry) throw fail("El avance elegido no existe.");
      if (entry.budget_id !== budgetId) throw fail(`El avance elegido no pertenece al presupuesto de la línea${where}.`);
      if (entry.status === "rejected") throw fail("El avance elegido es de un certificado rechazado.");
    }

    const key = `${budgetId}|${orderId || 0}|${line.concept}`;
    if (seen.has(key)) throw fail(`El concepto de ${label[line.concept]} está repetido en la factura${order ? ` para la OC ${order.number}` : ''}${where}.`);
    seen.add(key);

    const base = ctx.bases[currency][line.concept];
    if (!(base.net > TOLERANCE)) {
      throw fail(`El presupuesto${budgets.size > 1 ? ` ${ctx.budget.number}` : ""} no tiene ${label[line.concept]} en ${currency}: no se puede facturar en esa moneda.`);
    }
    const budgetKey = `${budgetId}|${line.concept}`;
    const balance = round2(base.net - ctx.billed[currency][line.concept] - (consumedBudget.get(budgetKey) || 0));

    // El usuario cargó el monto O el porcentaje; el otro se recalcula.
    let net;
    let percent;
    if (num(line.net_amount) > 0) {
      net = round2(line.net_amount);
      percent = round4((net / base.net) * 100);
    } else if (num(line.percent) > 0) {
      net = round2((base.net * num(line.percent)) / 100);
      percent = round4(line.percent);
    } else {
      throw fail(`Indicá el porcentaje o el monto a facturar de ${label[line.concept]}${where}.`);
    }
    if (!(net > 0)) throw fail(`El monto de ${label[line.concept]} es demasiado chico.`);
    if (net > balance + TOLERANCE) {
      throw fail(`El monto de ${label[line.concept]}${where} supera el saldo disponible (${currency} ${Math.max(balance, 0).toLocaleString("es-AR", { minimumFractionDigits: 2 })}).`);
    }
    consumedBudget.set(budgetKey, round2((consumedBudget.get(budgetKey) || 0) + net));

    // Contra la OC: si tiene monto, también hay que respetar su saldo.
    if (order && order.amount !== null) {
      const orderBalance = round2(num(order.amount) - order.billedSoFar - (consumedOrder.get(order.id) || 0));
      if (net > orderBalance + TOLERANCE) {
        throw fail(`El monto de ${label[line.concept]} supera el saldo de la OC ${order.number} (${currency} ${Math.max(orderBalance, 0).toLocaleString("es-AR", { minimumFractionDigits: 2 })}).`);
      }
    }
    if (order) consumedOrder.set(order.id, round2((consumedOrder.get(order.id) || 0) + net));

    return {
      budget_id: budgetId,
      purchase_order_id: orderId,
      progress_entry_id: progressId,
      concept: line.concept,
      description: line.description ? String(line.description).trim().slice(0, 255) || null : null,
      percent,
      net_amount: net,
      base_gross_amount: base.gross,
      base_discount_percent: base.discount_percent,
      base_net_amount: base.net,
    };
  });
}

/** Neto, IVA y total de una factura a partir de sus líneas y la alícuota. Lo calcula el servidor. */
function computeInvoiceTotals(lines, ivaRate) {
  const net = round2(lines.reduce((acc, l) => acc + num(l.net_amount), 0));
  const iva = round2((net * num(ivaRate)) / 100);
  return { net_amount: net, iva_amount: iva, total_amount: round2(net + iva) };
}

module.exports = {
  CONCEPTS,
  CURRENCIES,
  TOLERANCE,
  round2,
  computeBudgetBillingBases,
  buildBillingSummary,
  loadBillingData,
  invoicesTouching,
  purchaseOrderBalances,
  computeBillingSummaries,
  validateInvoiceLines,
  computeInvoiceTotals,
};
