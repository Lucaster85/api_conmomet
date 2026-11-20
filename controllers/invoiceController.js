const { sendServerError } = require("../helpers/httpErrors");
const { Op } = require("sequelize");
const db = require("../models");
const { uploadToR2, deleteFromR2, userHasPermission } = require("../helpers");
const { recordAudit } = require("../services/auditLogService");
const { getInvoiceIvaRates } = require("../helpers/systemSettings");
const billing = require("../services/billingService");
const billingDocs = require("../services/billingDocsService");
const { todayInArgentina } = require("../helpers/argentinaDate");
const emission = require("../services/arca/emission");
const pdfService = require("../services/arca/pdfService");
const noteService = require("../services/creditNoteService");
const adjustmentService = require("../services/adjustmentService");
const ocaBilling = require("../services/ocaBillingService");
const ipc = require("../services/ipcService");
const fe = require("../services/arca/feRequest");
const arca = require("../services/arca");
const { ArcaError } = require("../services/arca/errors");
const { CBTE_TIPO, CBTE_TIPO_LABELS, RECEIVER_VAT_CONDITIONS_CLASS_A, CLIENT_TAX_CONDITION_TO_ARCA, IVA_ID, FCE_TRANSFER_OPTIONS } = require("../services/arca/codes");

/**
 * Facturación (ver FLOWS.md, sección Facturación).
 *
 * Todo cuelga de /invoices, así que el path de middlewares/auth.js lo resuelve con invoices_read /
 * write / update. Dos permisos más se chequean acá, a mano (mismo patrón que budgets_send):
 * - invoices_unofficial: cargar, ver y operar los cobros "sin factura".
 * - invoices_correct: corregir los datos de una factura ya cargada.
 * Las facturas no se borran (no hay DELETE): se anulan.
 */

const VOUCHER_TYPES = ["A", "B", "C", "E", "sin_factura"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BUDGETS_PER_INVOICE = 20;

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const canSeeUnofficial = (user) => userHasPermission(user, "invoices_unofficial");
// "Hoy" en Argentina, no el de UTC (Railway corre en UTC: pasadas las 21 hs el UTC ya es mañana, B3).
const todayStr = () => todayInArgentina();

// Código de ARCA por letra: ARCA numera por punto de venta Y tipo de comprobante, así que la clave única es
// (cbte_tipo, pos_number, number) y la carga manual tiene que decir qué tipo es (B1). Sin elegir, es la factura de esa letra.
const CBTE_TYPES_BY_LETTER = { A: [1, 2, 3, 201, 202, 203], B: [6, 7, 8, 206, 207, 208], C: [11, 12, 13], E: [19, 20, 21] };
const DEFAULT_CBTE_TYPE = { A: 1, B: 6, C: 11, E: 19 };
const voucherLabel = (cbteTipo, voucherType, pos, number) =>
  `${CBTE_TIPO_LABELS[cbteTipo] || `Comprobante ${voucherType}`} ${String(pos).padStart(4, "0")}-${String(number).padStart(8, "0")}`;
const trimOrNull = (v, max) => {
  const value = emptyToNull(v);
  return value === null ? null : String(value).trim().slice(0, max) || null;
};
const toBool = (v) => (v === true || v === "true" || v === "1" || v === 1 ? true : v === false || v === "false" || v === "0" || v === 0 ? false : null);

const isValidDate = (value) => {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};

const emptyToNull = (v) => (v === undefined || v === null || v === "" ? null : v);
const toIntOrNull = (v) => {
  const value = emptyToNull(v);
  if (value === null) return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
};

// El alta y la corrección llegan como multipart (el PDF + los campos): `lines` viaja como JSON en
// un string. Con un body JSON común ya viene como array.
function parseBody(req) {
  const body = { ...req.body };
  if (typeof body.lines === "string") {
    try {
      body.lines = JSON.parse(body.lines);
    } catch {
      throw fail("Las líneas de la factura no tienen un formato válido.");
    }
  }
  return body;
}

const invoiceInclude = [
  { model: db.Client, as: "client", attributes: ["id", "razonSocial", "cuit", "tax_condition", "fce_transfer_option"] },
  { model: db.Budget, as: "budget", attributes: ["id", "number", "title", "status"] },
  { model: db.Project, as: "project", attributes: ["id", "code", "name", "is_additional"] },
  { model: db.User, as: "createdBy", attributes: ["id", "name", "lastname"] },
  {
    model: db.InvoiceLine, as: "lines",
    include: [
      { model: db.Budget, as: "budget", attributes: ["id", "number", "title"] },
      { model: db.ClientPurchaseOrder, as: "purchaseOrder", attributes: ["id", "number", "allows_adjustment", "adjustment_type", "adjustment_notes"] },
      { model: db.Oca, as: "oca", attributes: ["id", "number", "type"] },
      { model: db.BudgetProgressEntry, as: "progressEntry", attributes: ["id", "percent", "date", "source", "certificate_number", "status"] },
    ],
  },
  { model: db.CompanyPointOfSale, as: "pointOfSale", attributes: ["id", "number", "usage_description", "type"] },
  { model: db.CompanyBankAccount, as: "bankAccount", attributes: ["id", "bank_name", "cbu", "alias"] },
  // Nota de crédito o de débito -> la factura original (para mostrar "s/ Factura A 0003-00000001").
  { model: db.Invoice, as: "associatedInvoice", attributes: ["id", "voucher_type", "cbte_tipo", "pos_number", "number", "issue_date"] },
  // Factura de ajuste -> la factura que ajusta (para mostrar "Ajuste s/ Factura A 0003-00000001").
  { model: db.Invoice, as: "adjustedInvoice", attributes: ["id", "voucher_type", "cbte_tipo", "pos_number", "number", "issue_date"] },
];

// Los DECIMAL de Sequelize llegan como string. Acá se convierten una sola vez para que el
// frontend no tenga que acordarse de hacerlo (sumar strings concatena).
const toNum = (v) => (v === null || v === undefined ? null : Number(v));

/**
 * Suma a las facturas YA EMITIDAS lo que se les acreditó con notas de crédito, para mostrarlo y para que el diálogo de la nota sepa cuánto
 * queda por acreditar de cada línea:
 * - `credited_total`: total de las notas de crédito emitidas (no anuladas).
 * - `lines[].credited_net`: neto ya acreditado de la línea, contando también los borradores (un borrador reserva lo que acredita).
 * Muta las facturas ya serializadas que recibe (son copias).
 */
async function withCredits(serialized) {
  const list = Array.isArray(serialized) ? serialized : [serialized];
  const originals = list.filter((inv) => (inv.kind || "invoice") === "invoice" && inv.source === "arca" && inv.arca_status === "authorized");
  if (originals.length === 0) return serialized;

  const lineIds = originals.flatMap((inv) => (inv.lines || []).map((l) => l.id));
  const [lineRows, noteRows] = await Promise.all([
    lineIds.length === 0 ? [] : db.InvoiceLine.findAll({
      where: { credits_line_id: { [Op.in]: lineIds } },
      include: [{ model: db.Invoice, as: "invoice", attributes: ["id"], required: true, where: { kind: "credit_note", status: { [Op.ne]: "cancelled" } } }],
    }),
    db.Invoice.findAll({
      // Las notas por diferencia de cambio están en pesos (la factura, en dólares): no cuentan como lo acreditado de la factura.
      where: { associated_invoice_id: { [Op.in]: originals.map((inv) => inv.id) }, kind: "credit_note", exchange_difference: false, arca_status: "authorized", status: { [Op.ne]: "cancelled" } },
      attributes: ["associated_invoice_id", "total_amount"],
    }),
  ]);
  const netByLine = new Map();
  lineRows.forEach((row) => netByLine.set(row.credits_line_id, billing.round2((netByLine.get(row.credits_line_id) || 0) + Number(row.net_amount))));
  const totalByInvoice = new Map();
  noteRows.forEach((row) => totalByInvoice.set(row.associated_invoice_id, billing.round2((totalByInvoice.get(row.associated_invoice_id) || 0) + Number(row.total_amount))));

  for (const inv of originals) {
    inv.credited_total = totalByInvoice.get(inv.id) || 0;
    inv.lines = (inv.lines || []).map((l) => ({ ...l, credited_net: netByLine.get(l.id) || 0 }));
  }
  return serialized;
}

// Presupuestos que cobra la factura, sacados de sus líneas (la cabecera solo tiene el presupuesto cuando es uno solo). FLOWS.md §70.
function budgetsOfLines(lines) {
  const seen = new Map();
  for (const line of lines || []) {
    const budget = line.budget || (line.budget_id ? { id: line.budget_id } : null);
    if (budget && !seen.has(budget.id)) seen.set(budget.id, budget);
  }
  return [...seen.values()];
}

/**
 * A las facturas emitidas les suma su ajuste VIGENTE, si lo tiene (`adjustment`: id, número, total, estado), para mostrarlo en el detalle de la original
 * y para que el listado sepa si todavía se puede crear uno. Muta las facturas ya serializadas que recibe (son copias).
 */
async function withAdjustments(serialized) {
  const list = Array.isArray(serialized) ? serialized : [serialized];
  const originals = list.filter((inv) => (inv.kind || "invoice") === "invoice" && !inv.adjusts_invoice_id && inv.source === "arca" && inv.arca_status === "authorized");
  if (originals.length === 0) return serialized;
  const rows = await db.Invoice.findAll({
    where: { adjusts_invoice_id: { [Op.in]: originals.map((inv) => inv.id) }, status: { [Op.ne]: "cancelled" } },
    attributes: ["id", "adjusts_invoice_id", "cbte_tipo", "pos_number", "number", "total_amount", "arca_status", "status", "issue_date"],
  });
  // Nota por diferencia de cambio vigente de cada factura en dólares (etapa 10): para no ofrecer otra y mostrarla.
  const exchangeRows = await db.Invoice.findAll({
    where: { associated_invoice_id: { [Op.in]: originals.map((inv) => inv.id) }, exchange_difference: true, status: { [Op.ne]: "cancelled" } },
    attributes: ["id", "associated_invoice_id", "kind", "cbte_tipo", "pos_number", "number", "total_amount", "arca_status", "status"],
  });
  const exchangeByOriginal = new Map(exchangeRows.map((row) => [row.associated_invoice_id, row]));
  const byOriginal = new Map(rows.map((row) => [row.adjusts_invoice_id, row]));
  for (const inv of originals) {
    const found = byOriginal.get(inv.id);
    inv.adjustment = found
      ? { id: found.id, cbte_tipo: found.cbte_tipo, pos_number: found.pos_number, number: found.number, total_amount: toNum(found.total_amount), arca_status: found.arca_status, status: found.status, issue_date: found.issue_date }
      : null;
    const exchange = exchangeByOriginal.get(inv.id);
    inv.exchange_note = exchange
      ? { id: exchange.id, kind: exchange.kind, cbte_tipo: exchange.cbte_tipo, pos_number: exchange.pos_number, number: exchange.number, total_amount: toNum(exchange.total_amount), arca_status: exchange.arca_status, status: exchange.status }
      : null;
  }
  return serialized;
}

function serializeInvoice(invoice) {
  const data = typeof invoice.toJSON === "function" ? invoice.toJSON() : invoice;
  return {
    ...data,
    budgets: budgetsOfLines(data.lines),
    exchange_rate: toNum(data.exchange_rate),
    total_amount_ars: toNum(data.total_amount_ars),
    exchange_diff_base_rate: toNum(data.exchange_diff_base_rate),
    exchange_diff_new_rate: toNum(data.exchange_diff_new_rate),
    exchange_diff_base_usd: toNum(data.exchange_diff_base_usd),
    net_amount: toNum(data.net_amount),
    iva_rate: toNum(data.iva_rate),
    iva_amount: toNum(data.iva_amount),
    total_amount: toNum(data.total_amount),
    lines: (data.lines || []).map((l) => ({
      ...l,
      percent: toNum(l.percent),
      net_amount: toNum(l.net_amount),
      progressEntry: l.progressEntry ? { ...l.progressEntry, percent: toNum(l.progressEntry.percent) } : l.progressEntry,
      adjustment_percent: toNum(l.adjustment_percent),
      adjustment_base_amount: toNum(l.adjustment_base_amount),
      base_gross_amount: toNum(l.base_gross_amount),
      base_discount_percent: toNum(l.base_discount_percent),
      base_net_amount: toNum(l.base_net_amount),
    })),
  };
}

// Para la auditoría: lo que se puede corregir de una factura, antes y después.
function auditSnapshot(invoice) {
  const data = serializeInvoice(invoice);
  const {
    voucher_type, pos_number, number, issue_date, due_date, client_id, budget_id, project_id, currency,
    exchange_rate, iva_rate, net_amount, iva_amount, total_amount, paid_at, notes, file_name,
  } = data;
  return {
    voucher_type, pos_number, number, issue_date, due_date, client_id, budget_id, project_id, currency,
    exchange_rate, iva_rate, net_amount, iva_amount, total_amount, paid_at, notes, file_name,
    lines: (data.lines || []).map((l) => ({ concept: l.concept, description: l.description, percent: l.percent, net_amount: l.net_amount })),
  };
}

const publicFileKey = (url) => (url ? url.replace(`${process.env.STORAGE_PUBLIC_URL}/`, "") : null);

/**
 * Valida el cuerpo de un alta o una corrección y devuelve los valores listos para guardar. Es el
 * mismo camino para las dos: la corrección es "volver a cargar bien" la factura. Los importes se
 * calculan siempre acá, contra el presupuesto real — nunca se toman del cliente.
 */
async function resolvePayload(body, { user, existing = null, transaction, mode = "manual" }) {
  // mode "arca": borrador para emitir por ARCA (siempre Factura A; el número lo asigna ARCA al emitir). mode "manual": la
  // factura ya hecha en la web de ARCA que se carga a mano (con su número).
  const isArca = mode === "arca";

  // Notas de crédito y de débito: otro camino (hereda casi todo de la factura original). Al editar un borrador de nota manda su propio `kind`.
  const noteKind = isArca
    ? (existing && ["credit_note", "debit_note"].includes(existing.kind) ? existing.kind : (["credit_note", "debit_note"].includes(body.kind) ? body.kind : null))
    : null;
  // Nota por diferencia de cambio (etapa 10): en pesos, sobre una factura en dólares; el tipo (débito o crédito) lo decide el signo de la diferencia.
  if (isArca && (existing ? existing.exchange_difference : toBool(body.exchange_difference) === true)) {
    return noteService.resolveExchangeDifferenceDraft({ body, existing, transaction });
  }
  if (noteKind) return noteService.resolveNoteDraft({ body, kind: noteKind, existing, transaction });

  // Factura de ajuste (etapa 8): otro camino, hereda casi todo de la factura que ajusta. Solo por ARCA; al editar un borrador de ajuste manda su vínculo.
  if (!isArca && emptyToNull(body.adjusts_invoice_id) !== null) throw fail("Los ajustes se emiten por ARCA, sobre una factura ya emitida.");
  if (isArca && (existing ? existing.adjusts_invoice_id : emptyToNull(body.adjusts_invoice_id) !== null)) {
    return adjustmentService.resolveAdjustmentDraft({ body, existing, transaction });
  }

  const voucherType = isArca ? "A" : body.voucher_type;
  if (!VOUCHER_TYPES.includes(voucherType)) throw fail("El tipo de comprobante no es válido.");
  const isUnofficial = voucherType === "sin_factura";
  if ((isUnofficial || existing?.voucher_type === "sin_factura") && !canSeeUnofficial(user)) {
    throw fail("No tenés permiso para cargar ni modificar cobros sin factura.", 403);
  }

  if (!isValidDate(body.issue_date)) throw fail("La fecha de emisión es obligatoria.");
  const dueDate = emptyToNull(body.due_date);
  if (dueDate !== null && !isValidDate(dueDate)) throw fail("El vencimiento de pago no es una fecha válida.");

  if (!["ARS", "USD"].includes(body.currency)) throw fail("La moneda de la factura no es válida.");

  // La cotización del dólar nunca lleva más de 2 decimales (ARCA la publica con más: acá se redondea a centavos, igual que la pantalla).
  const rawExchangeRate = emptyToNull(body.exchange_rate);
  if (rawExchangeRate !== null && !(Number(rawExchangeRate) > 0)) throw fail("La cotización tiene que ser un número mayor a cero.");
  const exchangeRate = rawExchangeRate === null ? null : Math.round(Number(rawExchangeRate) * 100) / 100;
  if (exchangeRate !== null && !(exchangeRate > 0)) throw fail("La cotización tiene que ser un número mayor a cero.");

  // Presupuestos: cada línea es de uno (`line.budget_id`, o el `budget_id` del cuerpo si la línea no lo dice). Una factura puede cobrar varios del mismo
  // cliente (FLOWS.md §70). Se bloquean las filas, ordenadas por id, mientras se valida el saldo: dos facturas simultáneas no pueden pasarse del saldo
  // juntas ni entrar en un deadlock. Sin presupuestos es una factura libre.
  const headerBudgetId = toIntOrNull(body.budget_id);
  if (Number.isNaN(headerBudgetId)) throw fail("El presupuesto no es válido.");
  const allBodyLines = Array.isArray(body.lines) ? body.lines : [];
  // Líneas que cobran una OCA entera (etapa 10, FLOWS.md §74): van por su propio camino y no tienen presupuesto.
  const isOcaLine = (l) => l && l.oca_id !== undefined && l.oca_id !== null && l.oca_id !== "";
  const ocaBodyLines = allBodyLines.filter(isOcaLine);
  const bodyLines = allBodyLines.filter((l) => !isOcaLine(l));
  const lineBudgetIds = bodyLines.map((l) => {
    const id = toIntOrNull(l.budget_id);
    if (Number.isNaN(id)) throw fail("Una línea tiene un presupuesto que no es válido.");
    return id === null ? headerBudgetId : id;
  });
  if (lineBudgetIds.some((id) => id === null) && lineBudgetIds.some((id) => id !== null)) {
    throw fail("Todas las líneas tienen que indicar su presupuesto, o ninguna (factura libre).");
  }
  const budgetIds = [...new Set(lineBudgetIds.filter((id) => id !== null))].sort((a, b) => a - b);
  if (budgetIds.length > MAX_BUDGETS_PER_INVOICE) throw fail(`Una factura admite hasta ${MAX_BUDGETS_PER_INVOICE} presupuestos.`);
  // Sin líneas, el presupuesto del cuerpo igual se valida (y después falla por falta de líneas con un mensaje claro).
  if (allBodyLines.length === 0 && headerBudgetId !== null) budgetIds.push(headerBudgetId);
  const withBudget = budgetIds.length > 0;

  const budgets = new Map();
  let clientId;
  let projectId;
  if (withBudget) {
    const rows = await db.Budget.findAll({ where: { id: budgetIds }, order: [["id", "ASC"]], transaction, lock: transaction.LOCK.UPDATE });
    for (const id of budgetIds) {
      const row = rows.find((b) => b.id === id);
      if (!row) throw fail("Presupuesto no encontrado.", 404);
      if (row.status !== "approved") throw fail("Solo se pueden facturar presupuestos aprobados.");
      budgets.set(id, row);
    }
    const clientIds = new Set(rows.map((b) => b.client_id));
    if (clientIds.size > 1) throw fail("Todas las líneas de una factura tienen que ser del mismo cliente.");
    clientId = rows[0].client_id;
    // El proyecto de la factura es el de sus presupuestos si todos comparten uno; si no, queda sin proyecto.
    const projectIds = new Set(rows.map((b) => b.project_id || null));
    projectId = projectIds.size === 1 ? [...projectIds][0] : null;
  } else if (ocaBodyLines.length > 0 && bodyLines.length === 0) {
    // Solo OCA: el cliente y el proyecto salen de las OCA (todas del mismo cliente).
    // Lectura con bloqueo y por id: tiene que ser lo PRIMERO que se lee en la transacción (una lectura común fija la "foto" de MySQL antes de esperar el bloqueo y
    // dejaría pasar dos facturas simultáneas de la misma OCA).
    const found = await db.Oca.findAll({
      where: { id: ocaBodyLines.map((l) => Number(l.oca_id)).filter(Number.isInteger) }, attributes: ["id", "client_id", "project_id"],
      order: [["id", "ASC"]], transaction, lock: transaction.LOCK.UPDATE,
    });
    if (found.length === 0) throw fail("OCA no encontrada.", 404);
    clientId = found[0].client_id;
    const projectIds = new Set(found.map((o) => o.project_id || null));
    projectId = projectIds.size === 1 ? [...projectIds][0] : null;
  } else {
    clientId = toIntOrNull(body.client_id);
    if (!clientId) throw fail("El cliente es obligatorio en una factura sin presupuesto.");
    const client = await db.Client.findByPk(clientId, { transaction });
    if (!client) throw fail("Cliente no encontrado.", 404);
    projectId = toIntOrNull(body.project_id);
    if (Number.isNaN(projectId)) throw fail("El proyecto no es válido.");
    if (projectId !== null) {
      const project = await db.Project.findByPk(projectId, { transaction });
      if (!project) throw fail("Proyecto no encontrado.", 404);
      if (project.client_id !== clientId) throw fail("El proyecto no pertenece al cliente elegido.");
    }
  }

  // IVA: "sin factura" no lleva. El resto, una de las alícuotas configuradas (o la que la factura
  // ya tenía, si se está corrigiendo y después se quitó de la lista).
  let ivaRate = 0;
  if (!isUnofficial) {
    const allowed = await getInvoiceIvaRates();
    const requested = emptyToNull(body.iva_rate);
    ivaRate = requested === null ? (allowed.includes(21) ? 21 : allowed[0]) : Number(requested);
    const keepsCurrent = existing && Number(existing.iva_rate) === ivaRate;
    if (!Number.isFinite(ivaRate) || (!allowed.includes(ivaRate) && !keepsCurrent)) {
      throw fail("La alícuota de IVA no está entre las configuradas.");
    }
  }

  // Borrador por ARCA: el punto de venta es uno de los de web service de "Datos de mi empresa".
  let pointOfSale = null;
  if (isArca) {
    const posId = toIntOrNull(body.point_of_sale_id);
    if (!posId || Number.isNaN(posId)) throw fail("Elegí el punto de venta.");
    pointOfSale = await db.CompanyPointOfSale.findByPk(posId, { transaction });
    if (!pointOfSale || !pointOfSale.is_active || pointOfSale.type !== "web_service") {
      throw fail("El punto de venta no es válido para emitir por ARCA (tiene que ser de tipo web service y estar activo).");
    }
  }

  // Número de comprobante: obligatorio y único por tipo (código de ARCA) y punto de venta (menos en "sin factura"). En un
  // borrador por ARCA no hay número todavía: lo asigna ARCA al emitir.
  let posNumber = isArca ? pointOfSale.number : null;
  let number = null;
  let cbteTipo = isArca ? CBTE_TIPO.FACTURA_A : null;
  if (isArca && emptyToNull(body.cbte_tipo) !== null) {
    // Por ARCA se emite Factura A (1) o Factura de Crédito Electrónica A (201). Lo elige a mano quien factura: no hay regla automática.
    const requested = Number(body.cbte_tipo);
    if (![CBTE_TIPO.FACTURA_A, CBTE_TIPO.FCE_A_FACTURA].includes(requested)) {
      throw fail("Por ahora se emite Factura A o Factura de Crédito Electrónica (FCE) A.");
    }
    cbteTipo = requested;
  }
  if (!isUnofficial && !isArca) {
    const requestedType = toIntOrNull(body.cbte_tipo);
    if (Number.isNaN(requestedType)) throw fail("El tipo de comprobante no es válido.");
    cbteTipo = requestedType === null ? DEFAULT_CBTE_TYPE[voucherType] : requestedType;
    if (!CBTE_TYPES_BY_LETTER[voucherType].includes(cbteTipo)) throw fail("El tipo de comprobante no corresponde a la letra elegida.");
    // Las notas se hacen desde la factura emitida en la app, no a mano: necesitan la factura original asociada para ajustar el saldo.
    if (fe.isNote(cbteTipo) || [7, 8, 12, 13, 20, 21].includes(cbteTipo)) {
      throw fail("Las notas de crédito y de débito se hacen desde la factura emitida en la app (\"Nota de crédito\" o \"Nota de débito\" en sus acciones).");
    }
    posNumber = toIntOrNull(body.pos_number);
    number = toIntOrNull(body.number);
    if (!posNumber || Number.isNaN(posNumber) || posNumber < 1 || posNumber > 99999) {
      throw fail("El punto de venta es obligatorio (1 a 99999).");
    }
    if (!number || Number.isNaN(number) || number < 1 || number > 99999999) {
      throw fail("El número de comprobante es obligatorio (1 a 99999999).");
    }
    const duplicate = await db.Invoice.findOne({
      where: { cbte_tipo: cbteTipo, pos_number: posNumber, number, ...(existing ? { id: { [Op.ne]: existing.id } } : {}) },
      paranoid: false,
      transaction,
    });
    if (duplicate) {
      throw fail(`Ya existe el comprobante ${voucherLabel(cbteTipo, voucherType, posNumber, number)}.`);
    }
  }

  // Líneas de presupuesto (o libres) y, aparte, las de OCA. Todo del mismo cliente; las OCA se bloquean después de los presupuestos (mismo orden siempre).
  let lines = [];
  if (bodyLines.length > 0 || ocaBodyLines.length === 0) {
    lines = await billing.validateInvoiceLines({
      budgets,
      defaultBudgetId: headerBudgetId,
      currency: body.currency,
      lines: bodyLines,
      excludeInvoiceId: existing ? existing.id : null,
      transaction,
    });
  }
  if (ocaBodyLines.length > 0) {
    const resolved = await ocaBilling.resolveOcaLines({ lines: ocaBodyLines, currency: body.currency, excludeInvoiceId: existing ? existing.id : null, transaction });
    for (const oca of resolved.ocas.values()) {
      if (oca.client_id !== clientId) throw fail("Todas las líneas de una factura tienen que ser del mismo cliente.");
    }
    lines = [...lines, ...resolved.lines];
  }
  const totals = billing.computeInvoiceTotals(lines, ivaRate);

  // Datos propios de la emisión por ARCA (el borrador se valida a fondo recién al emitir: services/arca/feRequest.js).
  let arcaValues = {};
  if (isArca) {
    if (IVA_ID[ivaRate] === undefined) throw fail(`ARCA no tiene la alícuota de IVA ${ivaRate}%.`);
    const concept = toIntOrNull(body.arca_concept);
    if (![1, 2, 3].includes(concept)) throw fail("Indicá el concepto: productos, servicios o ambos.");
    const serviceFrom = emptyToNull(body.service_from);
    const serviceTo = emptyToNull(body.service_to);
    for (const [label, value] of [["desde", serviceFrom], ["hasta", serviceTo]]) {
      if (value !== null && !isValidDate(value)) throw fail(`La fecha ${label} del período facturado no es válida.`);
    }
    const client = await db.Client.findByPk(clientId, { transaction });
    const requestedVat = toIntOrNull(body.recipient_vat_condition_id);
    if (requestedVat !== null && !RECEIVER_VAT_CONDITIONS_CLASS_A[requestedVat]) {
      throw fail("La condición de IVA del receptor no admite Factura A.");
    }
    const sameCurrency = body.currency === "USD" ? toBool(body.same_currency_payment) : null;

    // FCE: cuenta del emisor y opción de transferencia. La cuenta se precarga con la predeterminada (la que sirva para la moneda) y la
    // opción con la del cliente o, si no tiene, la de la empresa. Se completan acá para que el borrador ya salga armado; lo que falte lo
    // frena la validación de la emisión.
    let bankAccountId = null;
    let fceTransfer = null;
    if (cbteTipo === CBTE_TIPO.FCE_A_FACTURA) {
      const requestedBank = toIntOrNull(body.bank_account_id);
      if (Number.isNaN(requestedBank)) throw fail("La cuenta bancaria no es válida.");
      if (requestedBank !== null) {
        const account = await db.CompanyBankAccount.findByPk(requestedBank, { transaction });
        if (!account || !account.is_active) throw fail("La cuenta bancaria elegida no existe o está inactiva.");
        bankAccountId = account.id;
      } else {
        const accounts = await db.CompanyBankAccount.findAll({ where: { is_active: true }, order: [["is_default", "DESC"], ["id", "ASC"]], transaction });
        const match = accounts.find((a) => !a.currency || a.currency === body.currency);
        bankAccountId = match ? match.id : null;
      }
      const requestedTransfer = emptyToNull(body.fce_transfer_option);
      if (requestedTransfer !== null && !FCE_TRANSFER_OPTIONS.includes(requestedTransfer)) {
        throw fail("La opción de transferencia de la FCE no es válida (SCA o ADC).");
      }
      const company = await db.CompanyProfile.findByPk(1, { transaction });
      fceTransfer = requestedTransfer || (client && client.fce_transfer_option) || (company && company.fce_transfer_option) || null;
    }

    arcaValues = {
      bank_account_id: bankAccountId,
      fce_transfer_option: fceTransfer,
      source: "arca",
      arca_status: "draft",
      arca_env: null,
      arca_result: null,
      point_of_sale_id: pointOfSale.id,
      arca_concept: concept,
      service_from: concept === 1 ? null : serviceFrom,
      service_to: concept === 1 ? null : serviceTo,
      recipient_doc_type: 80,
      recipient_doc_number: client ? client.cuit : null,
      recipient_vat_condition_id: requestedVat !== null ? requestedVat : (client ? CLIENT_TAX_CONDITION_TO_ARCA[client.tax_condition] || null : null),
      same_currency_payment: sameCurrency,
      total_amount_ars: body.currency === "USD" && exchangeRate !== null ? billing.round2(totals.total_amount * Number(exchangeRate)) : totals.total_amount,
      sale_condition: trimOrNull(body.sale_condition, 60),
      remito_number: trimOrNull(body.remito_number, 30),
      commercial_reference: trimOrNull(body.commercial_reference, 255),
    };
  }

  return {
    lines,
    values: {
      voucher_type: voucherType,
      cbte_tipo: cbteTipo,
      pos_number: posNumber,
      number,
      ...arcaValues,
      issue_date: body.issue_date,
      due_date: dueDate,
      client_id: clientId,
      // La cabecera conserva el presupuesto solo si todas las líneas son de uno (compatibilidad); las lecturas salen de las líneas (B10).
      budget_id: budgets.size === 1 ? [...budgets.keys()][0] : null,
      project_id: projectId,
      currency: body.currency,
      exchange_rate: exchangeRate === null ? null : Number(exchangeRate),
      iva_rate: ivaRate,
      ...totals,
      notes: emptyToNull(body.notes) === null ? null : String(body.notes).trim(),
    },
  };
}

async function findInvoiceOr404(id, user, options = {}) {
  const invoice = await db.Invoice.findByPk(id, { include: [{ model: db.InvoiceLine, as: "lines" }], ...options });
  // Un cobro "sin factura" no existe para quien no tiene el permiso: ni siquiera se confirma que está.
  if (!invoice || (invoice.voucher_type === "sin_factura" && !canSeeUnofficial(user))) {
    throw fail("Factura no encontrada.", 404);
  }
  return invoice;
}

const reloadFull = (id) => db.Invoice.findByPk(id, { include: invoiceInclude });
const sendError = (res, error) => {
  // Red de seguridad: dos altas simultáneas con el mismo número pasan la validación del
  // controller pero las frena el índice único de la base.
  if (error.name === "SequelizeUniqueConstraintError") {
    if (String(error.parent && error.parent.sqlMessage).includes("invoices_active_adjusts_unique")) {
      return res.status(409).json({ error: "La factura ya tiene un ajuste vigente: solo se puede crear otro si ese se anula." });
    }
    return res.status(400).json({ error: "Ya existe un comprobante con ese tipo, punto de venta y número." });
  }
  // Fallas de la conexión con ARCA: mensaje legible (nunca credenciales ni el sobre SOAP) y status según el caso.
  if (error instanceof ArcaError) {
    return res.status(error.code === "disabled" || error.code === "config" ? 409 : 502).json({ error: error.message, code: `arca_${error.code}` });
  }
  if (!error.status) return sendServerError(res, error);
  return res.status(error.status).json({ error: error.message, ...(error.problems ? { problems: error.problems } : {}) });
};

// Cabecera del presupuesto que va con cada fila de "Por facturar".
function budgetHeader(budget) {
  const b = budget.toJSON();
  return {
    id: b.id,
    number: b.number,
    title: b.title,
    status: b.status,
    currency: b.currency,
    approved_at: b.approved_at,
    sent_at: b.sent_at,
    labor_discount_percent: toNum(b.labor_discount_percent),
    material_discount_percent: toNum(b.material_discount_percent),
    project_id: b.project_id,
    client: b.client,
    project: b.project,
    quoteRequest: b.quoteRequest,
  };
}

const billableInclude = [
  { model: db.Client, as: "client", attributes: ["id", "razonSocial", "cuit", "tax_condition", "fce_transfer_option"] },
  {
    model: db.Project, as: "project", attributes: ["id", "code", "name", "is_additional"],
    include: [{ model: db.Project, as: "parent", attributes: ["id", "code", "name"] }],
  },
  { model: db.QuoteRequest, as: "quoteRequest", attributes: ["id", "number", "client_quote_number", "title"] },
];

function ivaInfo(rates) {
  return { rates, default_rate: rates.includes(21) ? 21 : rates[0] };
}

module.exports = {
  // GET /invoices/billables — presupuestos aprobados con su resumen de facturación.
  billables: async (req, res) => {
    try {
      const { client_id, billing_status, has_pending_payment, q } = req.query;
      const where = { status: "approved" };
      if (client_id) where.client_id = client_id;

      let budgets = await db.Budget.findAll({ where, include: billableInclude, order: [["approved_at", "ASC"], ["id", "ASC"]] });

      if (q && String(q).trim()) {
        const needle = String(q).trim().toLowerCase();
        budgets = budgets.filter((b) => [
          b.number, b.title, b.client?.razonSocial, b.client?.cuit, b.project?.code, b.project?.name,
          b.quoteRequest?.number, b.quoteRequest?.client_quote_number,
        ].some((field) => field && String(field).toLowerCase().includes(needle)));
      }

      const summaries = await billing.computeBillingSummaries(budgets, { canSeeUnofficial: canSeeUnofficial(req.user) });

      const orderSummaries = await billingDocs.purchaseOrderSummaries(budgets.map((b) => b.id));
      let rows = budgets.map((b) => ({
        ...budgetHeader(b),
        billing: summaries.get(b.id),
        purchase_order: { ...(orderSummaries.get(b.id) || { active_count: 0, numbers: [], orders: [] }), not_required: !!b.purchase_order_not_required },
      }));
      if (billing_status) rows = rows.filter((r) => r.billing.billing_status === billing_status);
      if (has_pending_payment === "true") rows = rows.filter((r) => r.billing.has_pending_payment);

      // Orden: primero lo que todavía tiene algo para facturar, y dentro de eso lo que tiene
      // materiales con saldo (se pueden facturar antes de empezar); después el más avanzado en
      // horas, y por último el aprobado hace más tiempo.
      rows.sort((a, b) => {
        const byBalance = Number(b.billing.has_balance) - Number(a.billing.has_balance);
        if (byBalance) return byBalance;
        const byMaterials = Number(b.billing.has_materials_balance) - Number(a.billing.has_materials_balance);
        if (byMaterials) return byMaterials;
        const progress = (r) => r.billing.project_progress?.progress_percent ?? -1;
        if (progress(b) !== progress(a)) return progress(b) - progress(a);
        return new Date(a.approved_at || 0) - new Date(b.approved_at || 0);
      });

      return res.status(200).json({ data: rows, iva: ivaInfo(await getInvoiceIvaRates()) });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // GET /invoices/billables/:budgetId — detalle de facturación de un presupuesto.
  billable: async (req, res) => {
    try {
      const budget = await db.Budget.findByPk(req.params.budgetId, { include: billableInclude });
      if (!budget) return res.status(404).json({ error: "Presupuesto no encontrado." });
      if (budget.status !== "approved") return res.status(400).json({ error: "Solo se factura sobre presupuestos aprobados." });

      const unofficial = canSeeUnofficial(req.user);
      const plain = budget.toJSON();
      const dataById = await billing.loadBillingData([plain]);
      const data = dataById.get(budget.id);
      const summary = billing.buildBillingSummary(plain, { ...data, canSeeUnofficial: unofficial });

      // Todas las facturas, anuladas incluidas (en gris). Los cobros "sin factura" se ocultan a
      // quien no tiene el permiso, pero ya están descontados del saldo.
      const allInvoices = data.allInvoices;
      const full = allInvoices.length === 0
        ? []
        : await db.Invoice.findAll({ where: { id: allInvoices.map((inv) => inv.id) }, include: invoiceInclude });
      // Una factura que cobra varios presupuestos aparece completa en cada uno, con la parte que le toca a este (`budget_share`).
      const shareById = new Map(data.invoices.map((inv) => [inv.id, inv]));
      const visible = full
        .filter((inv) => unofficial || inv.voucher_type !== "sin_factura")
        .sort((a, b) => (a.issue_date < b.issue_date ? 1 : a.issue_date > b.issue_date ? -1 : b.id - a.id))
        .map((inv) => {
          const serialized = serializeInvoice(inv);
          const share = shareById.get(inv.id);
          if (share && share.shared) {
            serialized.budget_share = { net_amount: toNum(share.net_amount), total_amount: toNum(share.total_amount) };
          }
          return serialized;
        });
      await withCredits(visible);
      await withAdjustments(visible);

      return res.status(200).json({
        data: {
          budget: budgetHeader(budget),
          billing: summary,
          hour_buckets: data.hours ? data.hours.hour_buckets : [],
          invoices: visible,
          has_reserved_records: !unofficial && allInvoices.some((inv) => inv.voucher_type === "sin_factura" && inv.status !== "cancelled"),
          iva: ivaInfo(await getInvoiceIvaRates()),
          purchase_order_not_required: !!budget.purchase_order_not_required,
          ...(await billingDocs.loadBudgetBillingDocs(budget.id)),
        },
      });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // GET /invoices — registro de comprobantes.
  getAll: async (req, res) => {
    try {
      const { status, client_id, voucher_type, date_from, date_to, budget_id, project_id, include_closed, arca_status, kind } = req.query;
      const where = {};
      if (arca_status) where.arca_status = arca_status;
      if (["invoice", "credit_note", "debit_note"].includes(kind)) where.kind = kind;
      if (status) where.status = status;
      else if (include_closed !== "true") where.status = { [Op.ne]: "cancelled" };
      if (client_id) where.client_id = client_id;
      if (budget_id) {
        // La relación con el presupuesto está en las líneas: una factura que cobra varios aparece en cada uno (FLOWS.md §70).
        const budgetNumber = Number(budget_id);
        if (!Number.isInteger(budgetNumber) || budgetNumber < 1) return res.status(400).json({ error: "El presupuesto no es válido." });
        where[Op.and] = [
          ...(where[Op.and] || []),
          db.sequelize.literal(`Invoice.id IN (SELECT invoice_id FROM InvoiceLines WHERE budget_id = ${budgetNumber})`),
        ];
      }
      if (project_id) where.project_id = project_id;
      if (date_from || date_to) {
        where.issue_date = {};
        if (date_from) where.issue_date[Op.gte] = date_from;
        if (date_to) where.issue_date[Op.lte] = date_to;
      }
      if (voucher_type) where.voucher_type = voucher_type;
      // Los cobros "sin factura" no existen para quien no tiene el permiso.
      if (!canSeeUnofficial(req.user)) {
        if (voucher_type === "sin_factura") return res.status(200).json({ data: [] });
        if (!voucher_type) where.voucher_type = { [Op.ne]: "sin_factura" };
      }

      const invoices = await db.Invoice.findAll({ where, include: invoiceInclude, order: [["issue_date", "DESC"], ["id", "DESC"]] });
      return res.status(200).json({ data: await withAdjustments(await withCredits(invoices.map(serializeInvoice))) });
    } catch (error) {
      return sendError(res, error);
    }
  },

  get: async (req, res) => {
    try {
      const found = await findInvoiceOr404(req.params.id, req.user);
      return res.status(200).json({ data: await withAdjustments(await withCredits(serializeInvoice(await reloadFull(found.id)))) });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // GET /invoices/client-options — clientes para el filtro y para la factura libre. Cuelga de
  // /invoices a propósito (como el catálogo de Adicionales): quien factura no necesariamente tiene
  // clients_read.
  clientOptions: async (req, res) => {
    try {
      const clients = await db.Client.findAll({
        attributes: ["id", "razonSocial", "cuit", "tax_condition", "is_active"],
        order: [["razonSocial", "ASC"]],
      });
      return res.status(200).json({ data: clients });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // GET /invoices/billable-ocas?client_id= — las OCA aprobadas de un cliente con su importe y si se pueden facturar (FLOWS.md §74). Cuelga de /invoices
  // (invoices_read): quien factura no necesita ocas_read para elegirlas.
  billableOcas: async (req, res) => {
    try {
      const clientId = Number(req.query.client_id);
      if (!Number.isInteger(clientId) || clientId < 1) throw fail("Indicá el cliente.");
      return res.status(200).json({ data: await ocaBilling.listBillableOcas(clientId) });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // GET /invoices/adjustments/ipc?from=AAAA-MM&to=AAAA-MM — variación del IPC del INDEC entre dos meses, para sugerir el % de un ajuste (FLOWS.md §73).
  // Sin `to`, va hasta el último mes publicado. Cuelga de /invoices (invoices_read): quien arma el ajuste no necesita otro permiso.
  ipcVariation: async (req, res) => {
    try {
      const from = String(req.query.from || "");
      if (!ipc.isMonth(from)) throw fail("Indicá el mes base como AAAA-MM.");
      let to = req.query.to ? String(req.query.to) : null;
      if (to !== null && !ipc.isMonth(to)) throw fail("Indicá el mes final como AAAA-MM.");
      if (to !== null && from >= to) throw fail("El mes base tiene que ser anterior al mes hasta el que se ajusta.");
      if (to === null) {
        to = await ipc.fetchLatestIpcMonth();
        if (!to) throw fail("No se pudo consultar el IPC del INDEC en este momento: cargá el porcentaje a mano.", 502);
      }
      const series = await ipc.fetchIpcSeries(from, to);
      if (!series) throw fail("No se pudo consultar el IPC del INDEC en este momento: cargá el porcentaje a mano.", 502);
      const result = ipc.ipcVariation(series, from, to);
      if (result.error) throw fail(result.error);
      return res.status(200).json({ data: result });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // GET /invoices/project-options?client_id= — proyectos del cliente, para la factura libre.
  projectOptions: async (req, res) => {
    try {
      const { client_id } = req.query;
      if (!client_id) return res.status(400).json({ error: "Indicá el cliente." });
      const projects = await db.Project.findAll({
        where: { client_id },
        attributes: ["id", "code", "name", "is_additional"],
        include: [{ model: db.Project, as: "parent", attributes: ["id", "code", "name"] }],
        order: [["created_at", "DESC"]],
      });
      return res.status(200).json({ data: projects });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // POST /invoices (multipart: `file` opcional + campos; `lines` como JSON).
  create: async (req, res) => {
    const transaction = await db.sequelize.transaction();
    let uploadedUrl = null;
    try {
      const body = parseBody(req);
      const isArca = body.source === "arca";
      const payload = await resolvePayload(body, { user: req.user, transaction, mode: isArca ? "arca" : "manual" });

      const invoice = await db.Invoice.create(
        { ...payload.values, status: "pending", created_by: req.user.id },
        { transaction },
      );
      await db.InvoiceLine.bulkCreate(payload.lines.map((l) => ({ ...l, invoice_id: invoice.id })), { transaction });

      // El PDF de una factura por ARCA lo genera el sistema (etapa 3): no se adjunta uno a mano.
      if (req.file && !isArca) {
        uploadedUrl = await uploadToR2(req.file, `invoices/${invoice.id}`);
        await invoice.update({ file_url: uploadedUrl, file_key: publicFileKey(uploadedUrl), file_name: req.file.originalname }, { transaction });
      }

      await recordAudit({
        entityType: "Invoice",
        entityId: invoice.id,
        action: "create",
        fieldChanged: "total_amount",
        newValue: payload.values.total_amount,
        amount: payload.values.total_amount,
        context: {
          source: payload.values.source || "manual",
          voucher_type: payload.values.voucher_type,
          cbte_tipo: payload.values.cbte_tipo,
          pos_number: payload.values.pos_number,
          number: payload.values.number,
          budget_id: payload.values.budget_id,
          currency: payload.values.currency,
          net_amount: payload.values.net_amount,
          iva_rate: payload.values.iva_rate,
        },
        userId: req.user.id,
      }, transaction);

      await transaction.commit();
      return res.status(201).json({ data: serializeInvoice(await reloadFull(invoice.id)) });
    } catch (error) {
      await transaction.rollback();
      if (uploadedUrl) deleteFromR2(uploadedUrl).catch(() => {});
      return sendError(res, error);
    }
  },

  // PUT /invoices/:id — corrige los datos de una factura mal cargada. Requiere invoices_correct
  // (además de invoices_update, que habilita la ruta). Pendiente o cobrada; una anulada no.
  update: async (req, res) => {
    const transaction = await db.sequelize.transaction();
    let uploadedUrl = null;
    try {
      const invoice = await findInvoiceOr404(req.params.id, req.user, { transaction, lock: transaction.LOCK.UPDATE });
      if (invoice.status === "cancelled") throw fail("Una factura anulada no se puede corregir.");

      // B4: una factura que ya tiene CAE (o está en proceso de emisión) NO se edita: ARCA ya la conoce. Un borrador o una
      // rechazada se editan con invoices_update, sin el permiso de corrección (todavía no existe para ARCA).
      const isArca = invoice.source === "arca";
      if (isArca && !["draft", "rejected"].includes(invoice.arca_status)) {
        throw fail("Una factura emitida por ARCA no se puede editar. Si hay un error, se anula con una nota de crédito.", 409);
      }
      if (!isArca && !userHasPermission(req.user, "invoices_correct")) {
        throw fail("No tenés permiso para corregir facturas.", 403);
      }

      const body = parseBody(req);
      const payload = await resolvePayload(body, { user: req.user, existing: invoice, transaction, mode: isArca ? "arca" : "manual" });
      const before = auditSnapshot(invoice);

      const updates = { ...payload.values };
      if (invoice.status === "paid" && emptyToNull(body.paid_at) !== null) {
        if (!isValidDate(body.paid_at)) throw fail("La fecha de cobro no es válida.");
        updates.paid_at = body.paid_at;
      }

      const previousFileUrl = invoice.file_url;
      if (req.file && !isArca) {
        uploadedUrl = await uploadToR2(req.file, `invoices/${invoice.id}`);
        Object.assign(updates, { file_url: uploadedUrl, file_key: publicFileKey(uploadedUrl), file_name: req.file.originalname });
      }

      await invoice.update(updates, { transaction });
      await db.InvoiceLine.destroy({ where: { invoice_id: invoice.id }, transaction });
      await db.InvoiceLine.bulkCreate(payload.lines.map((l) => ({ ...l, invoice_id: invoice.id })), { transaction });

      const fresh = await db.Invoice.findByPk(invoice.id, { include: [{ model: db.InvoiceLine, as: "lines" }], transaction });
      await recordAudit({
        entityType: "Invoice",
        entityId: invoice.id,
        action: "update",
        fieldChanged: "invoice",
        amount: payload.values.total_amount,
        context: { before, after: auditSnapshot(fresh) },
        userId: req.user.id,
      }, transaction);

      await transaction.commit();
      if (uploadedUrl && previousFileUrl) deleteFromR2(previousFileUrl).catch(() => {});
      return res.status(200).json({ data: serializeInvoice(await reloadFull(invoice.id)) });
    } catch (error) {
      await transaction.rollback();
      if (uploadedUrl) deleteFromR2(uploadedUrl).catch(() => {});
      return sendError(res, error);
    }
  },

  // PUT /invoices/:id/pay (multipart) — { paid_at } y, opcional, `file` con el comprobante de pago.
  // Pendiente -> cobrada. No hay cobros parciales.
  pay: async (req, res) => {
    let uploadedUrl = null;
    try {
      const invoice = await findInvoiceOr404(req.params.id, req.user);
      if (invoice.status !== "pending") throw fail("Solo se puede marcar como cobrada una factura pendiente de cobro.");
      if (invoice.source === "arca" && invoice.arca_status !== "authorized") {
        throw fail("Solo se puede marcar como cobrada una factura que ya fue emitida en ARCA.", 409);
      }
      if (invoice.kind === "credit_note") throw fail("Una nota de crédito no se cobra: baja lo que falta cobrar de su factura.", 409);

      const paidAt = emptyToNull(req.body.paid_at) || todayStr();
      if (!isValidDate(paidAt)) throw fail("La fecha de cobro no es válida.");

      const updates = { status: "paid", paid_at: paidAt };
      if (req.file) {
        uploadedUrl = await uploadToR2(req.file, `invoices/${invoice.id}/payment`);
        Object.assign(updates, {
          payment_file_url: uploadedUrl,
          payment_file_key: publicFileKey(uploadedUrl),
          payment_file_name: req.file.originalname,
        });
      }

      await invoice.update(updates);
      await recordAudit({
        entityType: "Invoice",
        entityId: invoice.id,
        action: "update",
        fieldChanged: "status",
        previousValue: "pending",
        newValue: "paid",
        amount: invoice.total_amount,
        context: { paid_at: paidAt, payment_receipt: req.file ? req.file.originalname : null },
        userId: req.user.id,
      });
      return res.status(200).json({ data: serializeInvoice(await reloadFull(invoice.id)) });
    } catch (error) {
      if (uploadedUrl) deleteFromR2(uploadedUrl).catch(() => {});
      return sendError(res, error);
    }
  },

  // PUT /invoices/:id/cancel — { reason }. Pendiente o cobrada -> anulada; libera el saldo.
  // Es para cuando la factura real se anuló: un dato mal cargado se corrige (PUT /:id), no se anula.
  cancel: async (req, res) => {
    try {
      const reason = String(req.body.reason || "").trim();
      if (!reason) throw fail("El motivo de la anulación es obligatorio.");

      const invoice = await findInvoiceOr404(req.params.id, req.user);
      if (invoice.status === "cancelled") throw fail("La factura ya está anulada.");
      // B4: las de ARCA no se anulan por la ruta vieja. Un borrador o una rechazada se descartan (nunca tuvieron CAE); una
      // emitida se anula con una nota de crédito (próxima etapa).
      if (invoice.source === "arca") {
        throw fail(
          ["draft", "rejected"].includes(invoice.arca_status)
            ? "Esta factura nunca se emitió: usá «Descartar»."
            : "Una factura de ARCA no se anula acá: se anula con una nota de crédito (\"Nota de crédito\" en sus acciones).",
          409
        );
      }

      const previousStatus = invoice.status;
      await invoice.update({ status: "cancelled", cancelled_at: new Date(), cancellation_reason: reason });
      await recordAudit({
        entityType: "Invoice",
        entityId: invoice.id,
        action: "update",
        fieldChanged: "status",
        previousValue: previousStatus,
        newValue: "cancelled",
        amount: invoice.total_amount,
        context: { reason },
        userId: req.user.id,
      });
      return res.status(200).json({ data: serializeInvoice(await reloadFull(invoice.id)) });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // GET /invoices/arca/options — lo que necesita el diálogo para ofrecer "Emitir por ARCA": si la integración está
  // prendida, el ambiente, los puntos de venta de web service y si faltan datos de la empresa. Cuelga de /invoices (y no de
  // /company-settings) a propósito: quien factura no necesariamente tiene company_settings_update (regla de los /lookup).
  arcaOptions: async (req, res) => {
    try {
      const [status, points, company, accounts] = await Promise.all([
        arca.getStatus(),
        db.CompanyPointOfSale.findAll({ where: { type: "web_service", is_active: true }, order: [["is_default", "DESC"], ["number", "ASC"]] }),
        db.CompanyProfile.findByPk(1),
        db.CompanyBankAccount.findAll({ where: { is_active: true }, order: [["is_default", "DESC"], ["bank_name", "ASC"]] }),
      ]);
      const missing = [];
      if (!company || !company.legal_name) missing.push("razón social");
      if (!company || !company.cuit) missing.push("CUIT");
      if (!company || !company.address_street || !company.address_locality || !company.address_province) missing.push("domicilio comercial");
      return res.status(200).json({
        data: {
          enabled: status.enabled,
          env: status.env,
          config_error: status.config_error,
          cuit_mismatch_blocks: status.cuit_mismatch_blocks,
          issuer_missing: missing,
          points_of_sale: points.map((p) => ({ id: p.id, number: p.number, usage_description: p.usage_description, is_default: p.is_default })),
          // Cuentas del emisor para elegir en una FCE (CBU y alias de la propia empresa) y la opción de transferencia por defecto.
          bank_accounts: accounts.map((a) => ({ id: a.id, bank_name: a.bank_name, cbu: a.cbu, alias: a.alias, currency: a.currency, is_default: a.is_default })),
          company_fce_transfer_option: company ? company.fce_transfer_option : "SCA",
          receiver_vat_conditions: Object.entries(RECEIVER_VAT_CONDITIONS_CLASS_A).map(([id, label]) => ({ id: Number(id), label })),
          client_tax_condition_map: CLIENT_TAX_CONDITION_TO_ARCA,
        },
      });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // GET /invoices/arca/exchange-rate — cotización del dólar según ARCA (FEParamGetCotizacion), para precargar el borrador.
  arcaExchangeRate: async (req, res) => {
    try {
      const quote = await arca.wsfe.getExchangeRate("DOL");
      return res.status(200).json({ data: { rate: quote.rate, date: quote.date } });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // POST /invoices/:id/emit — emite el borrador en ARCA. invoices_emit además de invoices_write (S3): es irreversible.
  emit: async (req, res) => {
    try {
      const invoice = await emission.emitInvoice(req.params.id, req.user);
      return res.status(200).json({ data: serializeInvoice(await reloadFull(invoice.id)) });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // POST /invoices/:id/verify — "Verificar en ARCA": resuelve una factura que quedó "autorizando".
  verify: async (req, res) => {
    try {
      const { outcome, invoice } = await emission.verifyInvoice(req.params.id, req.user);
      return res.status(200).json({ data: serializeInvoice(await reloadFull(invoice.id)), outcome });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // POST /invoices/:id/pdf — genera (o regenera) el PDF de una factura emitida por ARCA. Idempotente: sale de los datos congelados al autorizar.
  generatePdf: async (req, res) => {
    try {
      const invoice = await pdfService.generateInvoicePdf(req.params.id);
      return res.status(200).json({ data: serializeInvoice(await reloadFull(invoice.id)) });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // GET /invoices/:id/preview-pdf — VISTA PREVIA del borrador con el formato de la factura final (sin número, CAE ni QR: asteriscos).
  // Devuelve el PDF; no guarda nada. Mismo permiso que ver facturas (invoices_read).
  previewPdf: async (req, res) => {
    try {
      const { buffer, fileName } = await pdfService.previewInvoicePdf(req.params.id);
      res.set({ "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${fileName}"`, "Cache-Control": "no-store" });
      return res.status(200).send(buffer);
    } catch (error) {
      return sendError(res, error);
    }
  },

  // PUT /invoices/:id/fce-acceptance — { status: "pending" | "accepted" | "rejected" }. La aceptación de una FCE por el cliente se carga
  // A MANO (consultarla en ARCA con wsfecred es una etapa futura). Solo para una FCE ya emitida.
  setFceAcceptance: async (req, res) => {
    try {
      const status = req.body && req.body.status;
      if (!["pending", "accepted", "rejected"].includes(status)) throw fail("El estado de aceptación no es válido.");
      const invoice = await findInvoiceOr404(req.params.id, req.user);
      if (invoice.source !== "arca" || invoice.arca_status !== "authorized" || Number(invoice.cbte_tipo) !== CBTE_TIPO.FCE_A_FACTURA || invoice.status === "cancelled") {
        throw fail("Solo se puede registrar la aceptación de una Factura de Crédito Electrónica ya emitida.", 409);
      }
      const previous = invoice.fce_acceptance;
      await invoice.update({ fce_acceptance: status, fce_acceptance_at: status === "pending" ? null : new Date() });
      await recordAudit({
        entityType: "Invoice", entityId: invoice.id, action: "update", fieldChanged: "fce_acceptance",
        previousValue: previous, newValue: status, amount: invoice.total_amount, userId: req.user.id,
      });
      return res.status(200).json({ data: serializeInvoice(await reloadFull(invoice.id)) });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // PUT /invoices/:id/discard — descarta un borrador o una rechazada (nunca tuvieron CAE) y libera el saldo.
  discard: async (req, res) => {
    try {
      const invoice = await emission.discardInvoice(req.params.id, req.user);
      return res.status(200).json({ data: serializeInvoice(await reloadFull(invoice.id)) });
    } catch (error) {
      return sendError(res, error);
    }
  },
};
