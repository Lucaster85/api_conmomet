// OC del cliente, cauciones y documentos extra del detalle de facturación (PLAN_ARCA.md etapa 6, FLOWS.md §69): lo que comparten los controllers y el detalle
// de facturación de un presupuesto (`GET /invoices/billables/:budgetId`).
const db = require("../models");
const { uploadToR2, deleteFromR2 } = require("../helpers/r2Storage");
const { suretyBondStatus, daysUntilExpiration } = require("./suretyBondService");
const { todayInArgentina } = require("../helpers/argentinaDate");
const billing = require("./billingService");
const progress = require("./budgetProgressService");

const toNum = (v) => (v === null || v === undefined ? null : Number(v));
const publicFileKey = (url) => (url ? url.replace(`${process.env.STORAGE_PUBLIC_URL}/`, "") : null);

const orderInclude = [
  { model: db.ClientPurchaseOrderItem, as: "items" },
  { model: db.ClientPurchaseOrderFile, as: "files", include: [{ model: db.User, as: "uploader", attributes: ["id", "name", "lastname"] }] },
  { model: db.ClientPurchaseOrder, as: "replaces", attributes: ["id", "number"] },
  { model: db.User, as: "createdBy", attributes: ["id", "name", "lastname"] },
];

function serializePurchaseOrder(order, balance = null) {
  const data = typeof order.toJSON === "function" ? order.toJSON() : order;
  return {
    ...data,
    // Lo facturado contra la OC y su saldo (null si no tiene monto). Solo cuando quien llama lo calculó.
    billed: balance ? balance.billed : undefined,
    balance: balance ? balance.balance : undefined,
    amount: toNum(data.amount),
    items: (data.items || []).map((i) => ({ ...i, amount: toNum(i.amount) })).sort((a, b) => a.id - b.id),
  };
}

function serializeSuretyBond(bond, today = todayInArgentina()) {
  const data = typeof bond.toJSON === "function" ? bond.toJSON() : bond;
  return { ...data, amount: toNum(data.amount), status: suretyBondStatus(data, today), days_left: daysUntilExpiration(data, today) };
}

const serializeBillingFile = (file) => (typeof file.toJSON === "function" ? file.toJSON() : file);

const reloadPurchaseOrder = (id) => db.ClientPurchaseOrder.findByPk(id, { include: orderInclude });

/** OC, cauciones y documentos de un presupuesto, listos para el detalle de facturación. */
async function loadBudgetBillingDocs(budgetId) {
  const today = todayInArgentina();
  const [orders, bonds, files, progressEntries] = await Promise.all([
    db.ClientPurchaseOrder.findAll({ where: { budget_id: budgetId }, include: orderInclude, order: [["date", "DESC"], ["id", "DESC"]] }),
    db.SuretyBond.findAll({
      where: { budget_id: budgetId },
      include: [{ model: db.ClientPurchaseOrder, as: "purchaseOrder", attributes: ["id", "number"] }],
      order: [["id", "DESC"]],
    }),
    db.BudgetBillingFile.findAll({ where: { budget_id: budgetId }, include: [{ model: db.User, as: "uploader", attributes: ["id", "name", "lastname"] }], order: [["id", "DESC"]] }),
    db.BudgetProgressEntry.findAll({
      where: { budget_id: budgetId },
      include: [
        { model: db.BudgetProgressEntryFile, as: "files", include: [{ model: db.User, as: "uploader", attributes: ["id", "name", "lastname"] }] },
        { model: db.User, as: "createdBy", attributes: ["id", "name", "lastname"] },
      ],
      order: [["date", "DESC"], ["id", "DESC"]],
    }),
  ]);
  const balances = await billing.purchaseOrderBalances(orders.map((o) => ({ id: o.id, currency: o.currency, amount: o.amount })));
  return {
    purchase_orders: orders.map((o) => serializePurchaseOrder(o, balances.get(o.id))),
    surety_bonds: bonds.map((b) => serializeSuretyBond(b, today)),
    billing_files: files.map(serializeBillingFile),
    progress_entries: progressEntries.map(progress.serializeEntry),
  };
}

/**
 * Por presupuesto: las OC vigentes (con lo facturado y el saldo de cada una) y sus números. Alimenta la columna "OC" del listado de facturación y la
 * elección de OC al armar una factura de varios presupuestos.
 */
async function purchaseOrderSummaries(budgetIds) {
  const map = new Map();
  if (!budgetIds.length) return map;
  const orders = await db.ClientPurchaseOrder.findAll({
    where: { budget_id: budgetIds, status: "active" },
    attributes: ["id", "budget_id", "number", "concept", "currency", "amount"],
    order: [["id", "ASC"]],
  });
  const balances = await billing.purchaseOrderBalances(orders.map((o) => ({ id: o.id, currency: o.currency, amount: o.amount })));
  for (const o of orders) {
    const entry = map.get(o.budget_id) || { active_count: 0, numbers: [], orders: [] };
    const balance = balances.get(o.id);
    entry.active_count += 1;
    entry.numbers.push(o.number);
    entry.orders.push({ id: o.id, number: o.number, concept: o.concept, currency: o.currency, amount: toNum(o.amount), billed: balance.billed, balance: balance.balance });
    map.set(o.budget_id, entry);
  }
  return map;
}

/**
 * Sube los archivos que llegaron en el pedido a R2 y los registra con `createRecord(fileData)`. Devuelve los avisos de lo que no se pudo subir: la entidad ya
 * está guardada, así que un archivo que falla no tira todo abajo (se puede volver a adjuntar).
 */
async function storeFiles(files, { folder, uploadedBy, createRecord }) {
  const warnings = [];
  for (const file of files || []) {
    try {
      const url = await uploadToR2(file, folder);
      await createRecord({
        file_url: url, file_key: publicFileKey(url), file_name: file.originalname, mime_type: file.mimetype, size_bytes: file.size, uploaded_by: uploadedBy,
      });
    } catch (error) {
      console.error(`[billing-docs] No se pudo guardar el archivo "${file.originalname}": ${error.message}`);
      warnings.push(`No se pudo subir "${file.originalname}": volvé a adjuntarlo.`);
    }
  }
  return warnings;
}

/** Borra de R2 sin tirar: el registro ya se resolvió, un archivo huérfano no justifica un error. */
const removeStoredFile = (url) => (url ? deleteFromR2(url).catch(() => {}) : Promise.resolve());

module.exports = {
  orderInclude, serializePurchaseOrder, serializeSuretyBond, serializeBillingFile, reloadPurchaseOrder, loadBudgetBillingDocs, purchaseOrderSummaries, storeFiles, removeStoredFile, publicFileKey, toNum,
};
