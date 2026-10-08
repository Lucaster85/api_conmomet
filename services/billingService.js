const { Op } = require("sequelize");
const db = require("../models");
const { computeConceptTotals } = require("../helpers/budgetTotals");
const { buildHourBuckets } = require("./projectHoursService");

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

const CONCEPTS = ["materials", "labor"];
const CURRENCIES = ["ARS", "USD"];
// Tolerancia de un centavo: los montos se redondean a 2 decimales y el porcentaje a 4.
const TOLERANCE = 0.01;

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const round4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;
const num = (v) => Number(v) || 0;

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

/** Suma lo facturado por moneda y concepto de una lista de facturas (con `lines`). */
function sumBilled(invoices) {
  const billed = {};
  for (const currency of CURRENCIES) billed[currency] = { materials: 0, labor: 0 };
  for (const invoice of invoices) {
    if (invoice.status === "cancelled") continue;
    for (const line of invoice.lines || []) {
      if (!billed[invoice.currency] || billed[invoice.currency][line.concept] === undefined) continue;
      billed[invoice.currency][line.concept] += num(line.net_amount);
    }
  }
  for (const currency of CURRENCIES) {
    for (const concept of CONCEPTS) billed[currency][concept] = round2(billed[currency][concept]);
  }
  return billed;
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
 */
function buildBillingSummary(budget, { laborLines, materialItems, invoices, hours, canSeeUnofficial }) {
  const bases = computeBudgetBillingBases(budget, laborLines, materialItems);
  const live = invoices.filter((inv) => inv.status !== "cancelled");
  const billed = sumBilled(live);

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
  const visibleLive = live.filter((inv) => canSeeUnofficial || inv.voucher_type !== "sin_factura");
  const pending = visibleLive.filter((inv) => inv.status === "pending");
  const pendingAmount = { ARS: 0, USD: 0 };
  for (const inv of pending) pendingAmount[inv.currency] = round2(pendingAmount[inv.currency] + num(inv.total_amount));

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

  return {
    budget_id: budget.id,
    bases,
    billed,
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
      allPaid: live.length > 0 && live.every((inv) => inv.status === "paid"),
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
  };
}

/**
 * Datos necesarios para armar los resúmenes de varios presupuestos con UNA query por tabla:
 * líneas, facturas y horas (buildHourBuckets sobre todos los proyectos a la vez).
 *
 * @param {Array<object>} budgets presupuestos (modelos o planos) con id, project_id y bonificaciones
 * @returns {Promise<Map<number, object>>} budget_id -> datos para buildBillingSummary
 */
async function loadBillingData(budgets, { transaction } = {}) {
  const budgetIds = budgets.map((b) => b.id);
  const result = new Map(budgetIds.map((id) => [id, { laborLines: [], materialItems: [], invoices: [], hours: null }]));
  if (budgetIds.length === 0) return result;

  const [laborLines, materialItems, invoices] = await Promise.all([
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
    db.Invoice.findAll({
      where: { budget_id: { [Op.in]: budgetIds } },
      include: [{ model: db.InvoiceLine, as: "lines" }],
      transaction,
    }),
  ]);

  laborLines.forEach((l) => result.get(l.budget_id).laborLines.push(l));
  materialItems.forEach((m) => result.get(m.budget_id).materialItems.push(m));
  invoices.forEach((inv) => result.get(inv.budget_id).invoices.push(inv.toJSON()));

  const projectIds = [...new Set(budgets.map((b) => b.project_id).filter(Boolean))];
  const bucketsByProject = await buildHourBuckets(projectIds);
  for (const budget of budgets) {
    if (budget.project_id && bucketsByProject.has(budget.project_id)) {
      result.get(budget.id).hours = bucketsByProject.get(budget.project_id);
    }
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
 * la base real del presupuesto.
 *
 * Con presupuesto: solo materiales / mano de obra, a lo sumo una línea por concepto, en la moneda
 * de la factura, sin pasarse del saldo (excluyendo la propia factura si se está corrigiendo).
 * Sin presupuesto (factura libre): solo líneas "other" con descripción y monto.
 *
 * @returns {Promise<Array>} líneas listas para InvoiceLine.bulkCreate
 * @throws {Error} con `status = 400` y un mensaje legible
 */
async function validateInvoiceLines({ budget, currency, lines, excludeInvoiceId = null, transaction }) {
  const fail = (message) => Object.assign(new Error(message), { status: 400 });

  if (!Array.isArray(lines) || lines.length === 0) throw fail("La factura necesita al menos una línea.");

  // Factura libre
  if (!budget) {
    return lines.map((line, index) => {
      if (line.concept !== "other") throw fail("Una factura sin presupuesto solo admite líneas de concepto \"Otro\".");
      const description = String(line.description || "").trim();
      if (!description) throw fail(`La línea ${index + 1} necesita una descripción.`);
      const net = round2(line.net_amount);
      if (!(net > 0)) throw fail(`La línea ${index + 1} necesita un monto mayor a cero.`);
      return { concept: "other", description: description.slice(0, 255), percent: null, net_amount: net };
    });
  }

  if (!CURRENCIES.includes(currency)) throw fail("La moneda de la factura no es válida.");

  const [laborLines, materialItems, invoices] = await Promise.all([
    db.BudgetLaborLine.findAll({ where: { budget_id: budget.id }, attributes: ["estimated_total", "currency"], raw: true, transaction }),
    db.BudgetMaterialItem.findAll({ where: { budget_id: budget.id }, attributes: ["total_price", "currency"], raw: true, transaction }),
    db.Invoice.findAll({
      where: { budget_id: budget.id, status: { [Op.ne]: "cancelled" }, ...(excludeInvoiceId ? { id: { [Op.ne]: excludeInvoiceId } } : {}) },
      include: [{ model: db.InvoiceLine, as: "lines" }],
      transaction,
    }),
  ]);

  const bases = computeBudgetBillingBases(budget.toJSON ? budget.toJSON() : budget, laborLines, materialItems);
  const billed = sumBilled(invoices.map((inv) => inv.toJSON()));
  const label = { materials: "materiales", labor: "mano de obra" };
  const seen = new Set();

  return lines.map((line) => {
    if (!CONCEPTS.includes(line.concept)) {
      throw fail("Una factura de un presupuesto solo admite conceptos de materiales o mano de obra.");
    }
    if (seen.has(line.concept)) throw fail(`El concepto de ${label[line.concept]} está repetido en la factura.`);
    seen.add(line.concept);

    const base = bases[currency][line.concept];
    if (!(base.net > TOLERANCE)) {
      throw fail(`El presupuesto no tiene ${label[line.concept]} en ${currency}: no se puede facturar en esa moneda.`);
    }
    const balance = round2(base.net - billed[currency][line.concept]);

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
      throw fail(`Indicá el porcentaje o el monto a facturar de ${label[line.concept]}.`);
    }
    if (!(net > 0)) throw fail(`El monto de ${label[line.concept]} es demasiado chico.`);
    if (net > balance + TOLERANCE) {
      throw fail(`El monto de ${label[line.concept]} supera el saldo disponible (${currency} ${balance.toLocaleString("es-AR", { minimumFractionDigits: 2 })}).`);
    }

    return {
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
  computeBillingSummaries,
  validateInvoiceLines,
  computeInvoiceTotals,
};
