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

module.exports = { getSystemSettings, getMaxLoanAmount };
