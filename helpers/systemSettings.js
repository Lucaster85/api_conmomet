const db = require("../models");

// Fila única (id: 1) — sembrada en helpers/seed.js. Si por algún motivo no existe todavía
// (ej. seed no corrió), devuelve el default en vez de romper cualquier validación que dependa
// de esto.
const DEFAULT_MAX_LOAN_AMOUNT_ARS = 1000000;

async function getSystemSettings() {
  const settings = await db.SystemSetting.findByPk(1);
  return settings || { max_loan_amount_ars: DEFAULT_MAX_LOAN_AMOUNT_ARS };
}

async function getMaxLoanAmount() {
  const settings = await getSystemSettings();
  return Number(settings.max_loan_amount_ars);
}

// Alícuotas de IVA que se ofrecen al cargar una factura (Configuración General). Arranca solo con
// 21%; el cliente agrega las que necesite. Siempre devuelve una lista no vacía y ordenada.
const DEFAULT_INVOICE_IVA_RATES = [21];

function parseIvaRates(raw) {
  let value = raw;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { value = null; }
  }
  if (!Array.isArray(value)) return [...DEFAULT_INVOICE_IVA_RATES];
  const rates = [...new Set(value.map(Number).filter((n) => Number.isFinite(n) && n >= 0 && n <= 100))];
  return rates.length > 0 ? rates.sort((a, b) => a - b) : [...DEFAULT_INVOICE_IVA_RATES];
}

async function getInvoiceIvaRates() {
  const settings = await getSystemSettings();
  return parseIvaRates(settings.invoice_iva_rates);
}

module.exports = { getSystemSettings, getMaxLoanAmount, getInvoiceIvaRates, parseIvaRates };
